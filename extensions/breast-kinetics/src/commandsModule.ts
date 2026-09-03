import { cache, imageLoader, utilities as csUtils } from '@cornerstonejs/core';

import { TOOL_NAME } from './constants';
import { id as extensionId } from './id';
import { phaseKey, PhaseState, useKineticsStore } from './store/useKineticsStore';
import { readImageTime } from './utils/imageTimes';
import { findPhaseCandidates } from './utils/phaseMatching';
import { renderRois } from './tools/BreastRoiTool';
import { CURVE_TYPE_LABELS, INITIAL_LABELS, KineticsResult } from './utils/kinetics';

export const PANEL_ID = `${extensionId}.panelModule.breastKinetics`;

const SUPPORTED_MODALITIES = ['MR', 'CT'];

export interface CsvRow {
  roiLabel: string;
  radiusMm: number;
  phaseLabels: string[];
  times: (number | null)[];
  means: (number | null)[];
  kinetics: KineticsResult;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
      title: 'Curvas cinéticas',
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
    commandsManager.run('setToolActiveToolbar', { toolName: TOOL_NAME, toolGroupIds: ['default'] });
  }

  /** Lee la hora de adquisición del corte central de una fase, cargándolo si hace falta. */
  async function readPhaseTime(imageIds: string[]) {
    if (!imageIds.length) {
      return { seconds: null, source: null } as const;
    }
    const imageId = imageIds[Math.floor(imageIds.length / 2)];
    if (!cache.getImage(imageId)) {
      await imageLoader.loadAndCacheImage(imageId);
    }
    return readImageTime(imageId);
  }

  const actions = {
    /**
     * Punto de entrada: empareja fases por geometría, abre el panel, lee las
     * horas de adquisición de los archivos y activa la herramienta de ROI.
     */
    breastKineticsActivate: async ({ viewportId }: { viewportId?: string } = {}) => {
      const targetViewportId = viewportId ?? viewportGridService.getActiveViewportId();
      const displaySet = displaySetForViewport(targetViewportId);
      if (!displaySet) {
        notify('No hay una serie en el viewport activo.');
        return;
      }
      if (!SUPPORTED_MODALITIES.includes(displaySet.Modality)) {
        notify('Las curvas cinéticas aplican a resonancia dinámica (MR).');
        return;
      }
      const studyUid = displaySet.StudyInstanceUID;
      const candidates = findPhaseCandidates(displaySetService.getActiveDisplaySets(), displaySet);
      const existing = useKineticsStore.getState().byStudy[studyUid];
      const phases: PhaseState[] = candidates.map(c => {
        const previous = existing?.phases.find(p => phaseKey(p) === phaseKey(c));
        return {
          ...c,
          active: previous?.active ?? !c.derived,
          acquisitionSeconds: previous?.acquisitionSeconds ?? null,
          timeSource: previous?.timeSource ?? null,
        };
      });
      useKineticsStore.getState().init(studyUid, displaySet.displaySetInstanceUID, phases);
      panelService.activatePanel(PANEL_ID, true);
      activateTool();

      if (phases.length < 2) {
        notify(
          'Sólo se encontró una fase con esta geometría; las curvas necesitan varias.',
          'info'
        );
      }

      // Horas de adquisición desde los archivos, en paralelo y sin bloquear la UI.
      await Promise.all(
        phases
          .filter(p => p.acquisitionSeconds === null)
          .map(async p => {
            try {
              const t = await readPhaseTime(p.imageIds);
              useKineticsStore.getState().setPhaseTime(studyUid, phaseKey(p), t.seconds, t.source);
            } catch (error) {
              console.warn('breastKineticsActivate: sin hora para', p.displaySetInstanceUID, error);
            }
          })
      );
      return studyUid;
    },

    breastKineticsTogglePhase: ({ studyUid, key }: { studyUid: string; key: string }) => {
      useKineticsStore.getState().togglePhase(studyUid, key);
    },

    breastKineticsSetRadius: ({ studyUid, radiusMm }: { studyUid: string; radiusMm: number }) => {
      useKineticsStore.getState().setRadius(studyUid, radiusMm);
      renderRois();
    },

    breastKineticsRemoveRoi: ({ studyUid, roiId }: { studyUid: string; roiId: number }) => {
      useKineticsStore.getState().removeRoi(studyUid, roiId);
      renderRois();
    },

    breastKineticsSelectRoi: ({ studyUid, roiId }: { studyUid: string; roiId: number }) => {
      useKineticsStore.getState().setActiveRoi(studyUid, roiId);
      activateTool();
      renderRois();
    },

    /** Lleva los viewports stack de las fases al corte de la ROI. */
    breastKineticsJumpToRoi: ({ studyUid, roiId }: { studyUid: string; roiId: number }) => {
      const state = useKineticsStore.getState().byStudy[studyUid];
      const roi = state?.rois.find(r => r.id === roiId);
      if (!state || !roi) {
        return;
      }
      const phaseUids = new Set(state.phases.map(p => p.displaySetInstanceUID));
      const { viewports } = viewportGridService.getState();
      viewports.forEach((info, viewportId) => {
        if (!info.displaySetInstanceUIDs?.some(uid => phaseUids.has(uid))) {
          return;
        }
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId) as {
          getImageIds?: () => string[];
          element?: HTMLDivElement;
        };
        const imageIds = viewport?.getImageIds?.();
        if (!imageIds?.length || !viewport.element) {
          return;
        }
        // Índice del corte cuyo plano contiene la ROI.
        let best = -1;
        let bestDist = Infinity;
        imageIds.forEach((imageId, i) => {
          const plane = csUtils.imageToWorldCoords(imageId, [0, 0]);
          if (!plane) {
            return;
          }
          const d = Math.abs(
            (plane[0] - roi.center[0]) * roi.normal[0] +
              (plane[1] - roi.center[1]) * roi.normal[1] +
              (plane[2] - roi.center[2]) * roi.normal[2]
          );
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        if (best >= 0) {
          csUtils.jumpToSlice(viewport.element, { imageIndex: best });
        }
      });
      useKineticsStore.getState().setActiveRoi(studyUid, roiId);
      renderRois();
    },

    breastKineticsExportCSV: ({ rows, studyLabel }: { rows: CsvRow[]; studyLabel: string }) => {
      if (!rows.length) {
        notify('No hay ROIs que exportar.');
        return;
      }
      const lines: string[] = ['Curvas cinéticas (tiempo-intensidad)', `Estudio,${studyLabel}`, ''];
      rows.forEach(row => {
        lines.push(`${row.roiLabel},radio ${row.radiusMm} mm`);
        lines.push(['Fase', ...row.phaseLabels].join(','));
        lines.push(
          ['Tiempo (s)', ...row.times.map(t => (t === null ? '' : t.toFixed(1)))].join(',')
        );
        lines.push(['Media', ...row.means.map(m => (m === null ? '' : m.toFixed(1)))].join(','));
        lines.push(
          [
            'Realce (%)',
            ...row.kinetics.relativePct.map(v => (v === null ? '' : v.toFixed(1))),
          ].join(',')
        );
        const k = row.kinetics;
        lines.push(
          `Realce inicial (%),${k.initialPct === null ? '' : k.initialPct.toFixed(1)},${
            k.initialCategory ? INITIAL_LABELS[k.initialCategory] : ''
          }`
        );
        lines.push(`Tardío (%),${k.delayedPct === null ? '' : k.delayedPct.toFixed(1)}`);
        lines.push(`Tipo,${k.type ? CURVE_TYPE_LABELS[k.type] : (k.reason ?? 'no clasificable')}`);
        lines.push('');
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`curvas-cineticas-${stamp}.csv`, lines.join('\n'));
    },

    breastKineticsNotify: ({ message }: { message: string }) => notify(message, 'info'),
  };

  const definitions = Object.fromEntries(
    Object.keys(actions).map(name => [name, { commandFn: actions[name] }])
  );

  return { actions, definitions, defaultContext: 'CORNERSTONE' };
};

export default commandsModule;
