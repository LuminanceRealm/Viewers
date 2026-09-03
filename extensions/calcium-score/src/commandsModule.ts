import { metaData } from '@cornerstonejs/core';
import { segmentation as csToolsSegmentation, Enums as csToolsEnums } from '@cornerstonejs/tools';

import {
  ARTERIES,
  CANDIDATE_COLOR,
  CANDIDATE_INDEX,
  HU_THRESHOLD,
  REFERENCE_KVP,
  TOOL_NAME,
  segmentationIdForDisplaySet,
} from './constants';
import { computeAgatston, riskCategory, AgatstonResult } from './utils/agatston';
import {
  buildSliceStack,
  ensureReferenceImagesLoaded,
  getCalciumSegmentationRefs,
  toAgatstonInput,
} from './utils/labelmapAccess';
import { id as extensionId } from './id';

const { triggerSegmentationDataModified } = csToolsSegmentation.triggerSegmentationEvents;

export const PANEL_ID = `${extensionId}.panelModule.calciumScore`;

/** Arteria por defecto al iniciar: la descendente anterior es la más afectada. */
const DEFAULT_ARTERY_INDEX = 2;

export interface CalciumScoreReport {
  result: AgatstonResult;
  warnings: string[];
  sliceIncrementMm: number;
  pixelSpacing: [number, number];
  depth: number;
}

/**
 * Avisos sobre la idoneidad del estudio. No bloquean: el radiólogo decide, pero
 * tiene que verlos.
 */
function studyWarnings(displaySet, sliceIncrementMm: number): string[] {
  const warnings: string[] = [];
  const instance =
    displaySet?.instances?.[0] ?? metaData.get('instance', displaySet?.imageIds?.[0]) ?? {};

  const kvp = Number(instance.KVP);
  if (kvp && Math.round(kvp) !== REFERENCE_KVP) {
    warnings.push(
      `Adquisición a ${kvp} kVp: el umbral de ${HU_THRESHOLD} HU está calibrado para ${REFERENCE_KVP} kVp.`
    );
  }

  if (!sliceIncrementMm) {
    warnings.push('No se pudo determinar el incremento entre cortes; el score no es fiable.');
  } else if (sliceIncrementMm < 2.4 || sliceIncrementMm > 3.6) {
    warnings.push(
      `Incremento de corte de ${sliceIncrementMm.toFixed(2)} mm; el score se normaliza a 3 mm.`
    );
  }

  const description = [
    instance.StudyDescription,
    displaySet?.StudyDescription,
    displaySet?.SeriesDescription,
    instance.ProtocolName,
  ]
    .filter(Boolean)
    .join(' ');
  if (/contrast|contraste|angio|cta\b|arterial|portal/i.test(description)) {
    warnings.push(
      'La descripción de la serie sugiere contraste; el score de calcio requiere una adquisición sin contraste.'
    );
  }

  return warnings;
}

function toCSV(report: CalciumScoreReport, displaySet): string {
  const lines: string[] = [];
  const category = riskCategory(report.result.total.score);
  lines.push('Score de calcio coronario (Agatston)');
  lines.push(`Serie,${JSON.stringify(displaySet?.SeriesDescription ?? '')}`);
  lines.push(`Incremento de corte (mm),${report.sliceIncrementMm.toFixed(2)}`);
  lines.push(
    `Tamaño de píxel (mm),${report.pixelSpacing[0].toFixed(3)} x ${report.pixelSpacing[1].toFixed(3)}`
  );
  lines.push('');
  lines.push('Arteria,Lesiones,Área (mm²),Volumen (mm³),Agatston');
  ARTERIES.forEach(artery => {
    const s = report.result.perSegment[artery.segmentIndex];
    lines.push(
      [
        `${artery.short} - ${artery.label}`,
        s.lesions,
        s.areaMm2.toFixed(1),
        s.volumeMm3.toFixed(1),
        Math.round(s.score),
      ].join(',')
    );
  });
  const t = report.result.total;
  lines.push(
    ['Total', t.lesions, t.areaMm2.toFixed(1), t.volumeMm3.toFixed(1), Math.round(t.score)].join(
      ','
    )
  );
  lines.push(`Categoría,${category.label}`);
  if (report.warnings.length) {
    lines.push('');
    report.warnings.forEach(w => lines.push(`Aviso,${JSON.stringify(w)}`));
  }
  return lines.join('\n');
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
    segmentationService,
    uiNotificationService,
    panelService,
  } = servicesManager.services;

  function resolveViewportId(viewportId?: string): string {
    return viewportId ?? viewportGridService.getActiveViewportId();
  }

  function displaySetForViewport(viewportId: string) {
    const uids = viewportGridService.getDisplaySetsUIDsForViewport(viewportId) ?? [];
    return uids.length ? displaySetService.getDisplaySetByUID(uids[0]) : undefined;
  }

  function notifyError(message: string) {
    uiNotificationService.show({
      title: 'Score de calcio',
      message,
      type: 'error',
      duration: 6000,
    });
  }

  function activatePickTool() {
    commandsManager.run('setToolActiveToolbar', {
      toolName: TOOL_NAME,
      toolGroupIds: ['default'],
    });
  }

  const actions = {
    /**
     * Punto de entrada desde la barra y el panel: prepara la serie si hace falta,
     * abre el panel y deja activa la herramienta de clic.
     */
    calciumScoreActivate: async ({ viewportId }: { viewportId?: string } = {}) => {
      const targetViewportId = resolveViewportId(viewportId);
      const displaySet = displaySetForViewport(targetViewportId);
      if (!displaySet) {
        notifyError('No hay una serie en el viewport activo.');
        return;
      }
      if (displaySet.Modality !== 'CT') {
        notifyError('El score de calcio sólo aplica a tomografía computarizada.');
        return;
      }

      const segmentationId = segmentationIdForDisplaySet(displaySet.displaySetInstanceUID);
      if (!getCalciumSegmentationRefs(segmentationId)) {
        const created = await actions.calciumScoreStart({ viewportId: targetViewportId });
        if (!created) {
          return;
        }
      } else if (
        !segmentationService
          .getSegmentationRepresentations(targetViewportId)
          .some(r => r.segmentationId === segmentationId)
      ) {
        await segmentationService.addSegmentationRepresentation(targetViewportId, {
          segmentationId,
          type: csToolsEnums.SegmentationRepresentations.Labelmap,
        });
      }

      segmentationService.setActiveSegmentation(targetViewportId, segmentationId);
      panelService.activatePanel(PANEL_ID, true);
      activatePickTool();
      return segmentationId;
    },

    /**
     * Crea la segmentación de la serie del viewport, carga todos los cortes y
     * marca como candidato cada píxel que supera el umbral.
     */
    calciumScoreStart: async ({ viewportId }: { viewportId?: string } = {}) => {
      const targetViewportId = resolveViewportId(viewportId);
      const displaySet = displaySetForViewport(targetViewportId);
      if (!displaySet || displaySet.Modality !== 'CT') {
        notifyError('El score de calcio sólo aplica a tomografía computarizada.');
        return;
      }

      const segmentationId = segmentationIdForDisplaySet(displaySet.displaySetInstanceUID);
      if (getCalciumSegmentationRefs(segmentationId)) {
        return segmentationId;
      }

      const imageIds: string[] = displaySet.imageIds ?? [];
      if (imageIds.length < 2) {
        notifyError('La serie necesita más de un corte.');
        return;
      }

      uiNotificationService.show({
        title: 'Score de calcio',
        message: `Cargando ${imageIds.length} cortes…`,
        type: 'info',
        duration: 3000,
      });

      try {
        await ensureReferenceImagesLoaded(imageIds);
      } catch (error) {
        console.error(error);
        notifyError('No se pudieron cargar todos los cortes de la serie.');
        return;
      }

      const segments = {};
      ARTERIES.forEach(artery => {
        segments[artery.segmentIndex] = {
          segmentIndex: artery.segmentIndex,
          label: `${artery.short} · ${artery.label}`,
          active: artery.segmentIndex === DEFAULT_ARTERY_INDEX,
        };
      });
      segments[CANDIDATE_INDEX] = {
        segmentIndex: CANDIDATE_INDEX,
        label: `Candidatos ≥ ${HU_THRESHOLD} HU`,
        active: false,
      };

      await segmentationService.createLabelmapForDisplaySet(displaySet, {
        segmentationId,
        label: 'Score de calcio',
        segments,
      });
      await segmentationService.addSegmentationRepresentation(targetViewportId, {
        segmentationId,
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
      });

      ARTERIES.forEach(artery => {
        segmentationService.setSegmentColor(
          targetViewportId,
          segmentationId,
          artery.segmentIndex,
          artery.color
        );
      });
      segmentationService.setSegmentColor(
        targetViewportId,
        segmentationId,
        CANDIDATE_INDEX,
        CANDIDATE_COLOR
      );

      const refs = getCalciumSegmentationRefs(segmentationId);
      if (!refs) {
        notifyError('La segmentación no quedó ligada a la serie.');
        return;
      }

      let stack;
      try {
        stack = buildSliceStack(refs);
      } catch (error) {
        console.error(error);
        notifyError(error.message);
        return;
      }

      const sliceSize = stack.width * stack.height;
      for (let k = 0; k < stack.depth; k++) {
        const labels = stack.labels[k];
        const hu = stack.huAt(k);
        for (let idx = 0; idx < sliceSize; idx++) {
          if (hu(idx) >= HU_THRESHOLD) {
            labels[idx] = CANDIDATE_INDEX;
          }
        }
      }
      triggerSegmentationDataModified(segmentationId);

      segmentationService.setActiveSegment(segmentationId, DEFAULT_ARTERY_INDEX);
      return segmentationId;
    },

    calciumScoreSetArtery: ({
      segmentationId,
      segmentIndex,
    }: {
      segmentationId: string;
      segmentIndex: number;
    }) => {
      segmentationService.setActiveSegment(segmentationId, segmentIndex);
      activatePickTool();
    },

    calciumScoreCompute: ({
      segmentationId,
    }: {
      segmentationId: string;
    }): CalciumScoreReport | undefined => {
      const refs = getCalciumSegmentationRefs(segmentationId);
      if (!refs) {
        return;
      }
      let stack;
      try {
        stack = buildSliceStack(refs);
      } catch (error) {
        console.warn(error);
        return;
      }
      const result = computeAgatston(toAgatstonInput(stack));
      const displaySet = displaySetService.getDisplaySetByUID(refs.displaySetInstanceUID);
      return {
        result,
        warnings: studyWarnings(displaySet, stack.sliceIncrementMm),
        sliceIncrementMm: stack.sliceIncrementMm,
        pixelSpacing: stack.pixelSpacing,
        depth: stack.depth,
      };
    },

    /** Aviso breve cuando un clic de la herramienta no puede aplicarse. */
    calciumScoreNotify: ({ message }: { message: string }) => {
      uiNotificationService.show({
        title: 'Score de calcio',
        message,
        type: 'info',
        duration: 3000,
      });
    },

    calciumScoreRemove: ({ segmentationId }: { segmentationId: string }) => {
      segmentationService.remove(segmentationId);
    },

    calciumScoreDownloadCSV: ({ segmentationId }: { segmentationId: string }) => {
      const report = actions.calciumScoreCompute({ segmentationId });
      const refs = getCalciumSegmentationRefs(segmentationId);
      if (!report || !refs) {
        notifyError('No hay resultados que exportar.');
        return;
      }
      const displaySet = displaySetService.getDisplaySetByUID(refs.displaySetInstanceUID);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`score-calcio-${stamp}.csv`, toCSV(report, displaySet));
    },
  };

  const definitions = Object.fromEntries(
    Object.keys(actions).map(name => [name, { commandFn: actions[name] }])
  );

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
};

export default commandsModule;
