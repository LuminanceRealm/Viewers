import {
  BaseVolumeViewport,
  metaData,
  Types as csTypes,
  utilities as csUtils,
} from '@cornerstonejs/core';

import { TOOL_NAME, Vec3 } from './constants';
import { id as extensionId } from './id';
import { useDentalStore } from './store/useDentalStore';
import { worldToGrid } from './utils/archGeometry';
import { createVolumeGrid, getVolumeGrid } from './utils/volumeGrid';

export const PANEL_ID = `${extensionId}.panelModule.dental`;

const commandsModule = ({ servicesManager, commandsManager }: withAppTypes) => {
  const {
    viewportGridService,
    displaySetService,
    uiNotificationService,
    panelService,
    cornerstoneViewportService,
  } = servicesManager.services;

  function notify(message: string, type: 'error' | 'info' = 'error') {
    uiNotificationService.show({
      title: 'Dental',
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

  /** Los cortes del volumen: la serie sin el localizador que a veces viene dentro. */
  function volumeImageIds(displaySet): string[] {
    const localizers: string[] = displaySet.localizerSOPInstanceUIDs ?? [];
    if (!localizers.length) {
      return displaySet.imageIds;
    }
    return displaySet.imageIds.filter(
      imageId => !localizers.includes(metaData.get('instance', imageId)?.SOPInstanceUID)
    );
  }

  const actions = {
    /**
     * Punto de entrada: valida la serie, carga todos los cortes, abre el panel
     * y la franja inferior, y deja activa la herramienta para trazar el arco.
     */
    dentalActivate: async ({ viewportId }: { viewportId?: string } = {}) => {
      const targetViewportId = viewportId ?? viewportGridService.getActiveViewportId();
      const displaySet = displaySetForViewport(targetViewportId);
      if (!displaySet) {
        notify('No hay una serie en el viewport activo.');
        return;
      }
      if (displaySet.Modality !== 'CT') {
        notify('La panorámica dental se reconstruye a partir de una tomografía (CBCT).');
        return;
      }

      const uid = displaySet.displaySetInstanceUID;
      const store = useDentalStore.getState();
      store.ensureSeries(uid);
      store.setDock({ activeUid: uid, open: true });
      // En teléfono el panel abierto deja la imagen en una rendija y ahí es donde
      // se traza el arco: la franja basta para empezar y el panel se abre a mano.
      if (window.innerWidth > 768) {
        panelService.activatePanel(PANEL_ID, true);
      }

      const current = useDentalStore.getState().bySeries[uid];
      if (current.loading !== null) {
        return uid;
      }
      if (!current.ready) {
        store.update(uid, { loading: 0, error: null });
        try {
          await createVolumeGrid(uid, volumeImageIds(displaySet), (done, total) =>
            useDentalStore.getState().update(uid, { loading: done / total })
          );
        } catch (error) {
          console.error(error);
          const message = (error as Error).message || 'No se pudo preparar la serie.';
          useDentalStore.getState().update(uid, { loading: null, error: message });
          notify(message);
          return;
        }
        useDentalStore.getState().update(uid, { ready: true, loading: null, error: null });
      }

      activateTool();
      return uid;
    },

    dentalTraceArch: () => activateTool(),

    /** Lleva los viewports que muestran la serie al corte axial del punto dado. */
    dentalJumpTo: ({ uid, world }: { uid: string; world: Vec3 }) => {
      const grid = getVolumeGrid(uid);
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
          // Stack: por índice con jumpToSlice, que emite los eventos de scroll
          // que escuchan los overlays; jumpToWorld no los dispara.
          const stack = viewport as csTypes.IStackViewport;
          if (!grid) {
            stack.jumpToWorld(world);
            return;
          }
          const k = Math.round(worldToGrid(grid, world)[2] / grid.spacing[2]);
          const imageId = grid.imageIds[Math.max(0, Math.min(grid.imageIds.length - 1, k))];
          const imageIndex = stack.getImageIds().indexOf(imageId);
          if (imageIndex >= 0) {
            csUtils.jumpToSlice(viewport.element, { imageIndex });
          }
        } catch (error) {
          console.warn('dentalJumpTo: no se pudo saltar en', viewportId, error);
        }
      });
    },

    dentalNotify: ({ message }: { message: string }) => notify(message, 'info'),
  };

  const definitions = Object.fromEntries(
    Object.keys(actions).map(name => [name, { commandFn: actions[name] }])
  );

  return { actions, definitions, defaultContext: 'CORNERSTONE' };
};

export default commandsModule;
