import {
  BaseVolumeViewport,
  getEnabledElementByViewportId,
  Types as csTypes,
  utilities as csUtils,
} from '@cornerstonejs/core';

import { ARTERIES, BETA_NOTICE, TOOL_NAME, Vec3 } from './constants';
import { lengthMm, stenosis } from './utils/measurements';
import { id as extensionId } from './id';
import { useCprStore } from './store/useCprStore';
import { createVolumeSampler, getVolumeSampler } from './utils/volumeSampler';
import { renderCenterlines } from './tools/CoronaryCenterlineTool';

export const PANEL_ID = `${extensionId}.panelModule.coronaryCpr`;

const commandsModule = ({ servicesManager, commandsManager }: withAppTypes) => {
  const {
    viewportGridService,
    displaySetService,
    uiNotificationService,
    panelService,
    toolGroupService,
    cornerstoneViewportService,
  } = servicesManager.services;

  function notify(message: string, type: 'error' | 'info' = 'error') {
    uiNotificationService.show({
      title: 'CPR coronario',
      message,
      type,
      duration: type === 'error' ? 6000 : 3000,
    });
  }

  function displaySetForViewport(viewportId: string) {
    const uids = viewportGridService.getDisplaySetsUIDsForViewport(viewportId) ?? [];
    return uids.length ? displaySetService.getDisplaySetByUID(uids[0]) : undefined;
  }

  function activateTool() {
    commandsManager.run('setToolActiveToolbar', {
      toolName: TOOL_NAME,
      toolGroupIds: ['default', 'mpr'],
    });
  }

  const actions = {
    /**
     * Punto de entrada: valida la serie, carga todos los cortes, abre el panel y
     * deja activa la herramienta de trazado.
     */
    coronaryCprActivate: async ({ viewportId }: { viewportId?: string } = {}) => {
      const targetViewportId = viewportId ?? viewportGridService.getActiveViewportId();
      const displaySet = displaySetForViewport(targetViewportId);
      if (!displaySet) {
        notify('No hay una serie en el viewport activo.');
        return;
      }
      if (displaySet.Modality !== 'CT') {
        notify('El CPR coronario sólo aplica a tomografía computarizada.');
        return;
      }

      const uid = displaySet.displaySetInstanceUID;
      const store = useCprStore.getState();
      store.ensureSeries(uid);
      panelService.activatePanel(PANEL_ID, true);

      if (!store.bySeries[uid]?.ready) {
        notify(`Cargando ${displaySet.imageIds.length} cortes…`, 'info');
        try {
          await createVolumeSampler(uid, displaySet.imageIds);
        } catch (error) {
          console.error(error);
          const message = (error as Error).message || 'No se pudo preparar la serie.';
          useCprStore.getState().update(uid, { error: message });
          notify(message);
          return;
        }
        // Toma la ventana del viewport para arrancar con la misma apariencia.
        const enabledElement = getEnabledElementByViewportId(targetViewportId);
        const voi = (enabledElement?.viewport as csTypes.IStackViewport)?.getProperties?.()
          ?.voiRange;
        const patch: Record<string, unknown> = { ready: true, error: null };
        if (voi && voi.upper > voi.lower) {
          patch.window = voi.upper - voi.lower;
          patch.level = (voi.upper + voi.lower) / 2;
        }
        useCprStore.getState().update(uid, patch);
      }

      activateTool();
      return uid;
    },

    coronaryCprSetArtery: ({ uid, arteryId }: { uid: string; arteryId: number }) => {
      useCprStore.getState().setActiveArtery(uid, arteryId);
      activateTool();
      renderCenterlines();
    },

    coronaryCprUndoPoint: ({ uid, arteryId }: { uid: string; arteryId: number }) => {
      useCprStore.getState().undoPoint(uid, arteryId);
      renderCenterlines();
    },

    coronaryCprClearArtery: ({ uid, arteryId }: { uid: string; arteryId: number }) => {
      useCprStore.getState().clearArtery(uid, arteryId);
      renderCenterlines();
    },

    /**
     * Lleva todos los viewports que muestran la serie al punto dado y recentra
     * el crosshair del MPR si está activo.
     */
    coronaryCprJumpTo: ({ uid, world }: { uid: string; world: Vec3 }) => {
      const { viewports } = viewportGridService.getState();
      viewports.forEach((viewportInfo, viewportId) => {
        if (!viewportInfo.displaySetInstanceUIDs?.includes(uid)) {
          return;
        }
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (!viewport) {
          return;
        }
        try {
          if (viewport instanceof BaseVolumeViewport) {
            (viewport as csTypes.IVolumeViewport).jumpToWorld(world);
            viewport.render();
            return;
          }
          // Stack: ir por índice con jumpToSlice, que emite los eventos de scroll
          // que escuchan los overlays; jumpToWorld no los dispara.
          const sampler = getVolumeSampler(uid);
          const stack = viewport as csTypes.IStackViewport;
          if (!sampler) {
            stack.jumpToWorld(world);
            return;
          }
          const k = Math.round(sampler.worldToIJK(world)[2]);
          const imageId = sampler.imageIds[Math.max(0, Math.min(sampler.imageIds.length - 1, k))];
          const imageIndex = stack.getImageIds().indexOf(imageId);
          if (imageIndex >= 0) {
            csUtils.jumpToSlice(viewport.element, { imageIndex });
          }
        } catch (error) {
          console.warn('coronaryCprJumpTo: no se pudo saltar en', viewportId, error);
        }
      });

      toolGroupService.getToolGroupIds().forEach(toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        const crosshairs = toolGroup?.getToolInstance('Crosshairs') as
          | { toolCenter?: Vec3; computeToolCenter?: () => void }
          | undefined;
        if (crosshairs?.computeToolCenter) {
          try {
            crosshairs.computeToolCenter();
          } catch {
            /* el toolgroup puede no tener viewports montados */
          }
        }
      });
    },

    /** CSV con las mediciones hechas sobre la tira (longitudes reales en 3D). */
    coronaryCprExportCSV: ({ uid, seriesLabel }: { uid: string; seriesLabel: string }) => {
      const series = useCprStore.getState().bySeries[uid];
      if (!series?.measurements.length) {
        notify('No hay mediciones que exportar.');
        return;
      }
      const lines: string[] = ['CPR coronario: mediciones'];
      if (BETA_NOTICE) {
        lines.push(BETA_NOTICE);
      }
      lines.push(`Serie,${JSON.stringify(seriesLabel)}`, '');
      lines.push('Arteria,Tipo,Valor,Referencia (mm),Mínimo (mm)');
      series.measurements.forEach(m => {
        const artery = ARTERIES.find(a => a.id === m.arteryId)?.short ?? '';
        if (m.kind === 'length') {
          const l = lengthMm(m.points);
          lines.push([artery, 'Regla', l === null ? '' : `${l.toFixed(1)} mm`, '', ''].join(','));
        } else {
          const s = stenosis(m.points);
          lines.push(
            [
              artery,
              'Estenosis',
              s?.percent == null ? '' : `${s.percent.toFixed(0)} %`,
              s ? s.referenceMm.toFixed(1) : '',
              s ? s.minimalMm.toFixed(1) : '',
            ].join(',')
          );
        }
      });
      const blob = new Blob(['\uFEFF', lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cpr-mediciones-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    coronaryCprNotify: ({ message }: { message: string }) => notify(message, 'info'),
  };

  const definitions = Object.fromEntries(
    Object.keys(actions).map(name => [name, { commandFn: actions[name] }])
  );

  return { actions, definitions, defaultContext: 'CORNERSTONE' };
};

export default commandsModule;
