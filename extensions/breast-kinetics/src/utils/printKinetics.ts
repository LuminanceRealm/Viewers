import { utils as csExtUtils } from '@ohif/extension-cornerstone';

import { BETA_NOTICE, roiColor } from '../constants';
import type { PhaseState, RoiState } from '../store/useKineticsStore';
import { CURVE_TYPE_LABELS, INITIAL_LABELS, KineticsResult } from './kinetics';
import type { StudySamples } from './sampleRois';

const {
  getPrintHeader,
  captureVisibleViewports,
  buildReportDocument,
  openPrintSheet,
  rasterizeSvg,
} = csExtUtils.printSheet;

export interface PrintKineticsOptions {
  displaySet;
  phases: PhaseState[];
  times: number[] | null;
  rois: RoiState[];
  samples: StudySamples | null;
  kineticsByRoi: Record<number, KineticsResult>;
  chartSvg: SVGSVGElement | null;
  viewportIds: string[];
}

function clock(seconds: number | null): string {
  if (seconds === null) {
    return 'sin hora';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Hoja imprimible de las curvas cinéticas: gráfica, fases con sus horas,
 * métricas y tipo por ROI, y captura del corte con las ROIs.
 */
export default async function printKineticsReport({
  displaySet,
  phases,
  times,
  rois,
  samples,
  kineticsByRoi,
  chartSvg,
  viewportIds,
}: PrintKineticsOptions): Promise<void> {
  const images: string[] = [];
  if (chartSvg) {
    try {
      images.push(await rasterizeSvg(chartSvg, 2));
    } catch (error) {
      console.warn('printKinetics: no se pudo rasterizar la gráfica', error);
    }
  }
  images.push(...(await captureVisibleViewports(viewportIds)));

  const phaseRows = phases.map((p, i) => [
    p.label,
    clock(p.acquisitionSeconds),
    times ? `${Math.round(times[i])} s` : `fase ${i}`,
  ]);

  const roiRows = rois.map(roi => {
    const k = kineticsByRoi[roi.id];
    const color = roiColor(roi.colorIndex);
    return [
      `${roi.label} (${color})`,
      `${roi.radiusMm} mm`,
      k && Number.isFinite(k.s0) ? k.s0.toFixed(0) : '–',
      k?.initialPct == null
        ? '–'
        : `${k.initialPct.toFixed(0)} % · ${k.initialCategory ? INITIAL_LABELS[k.initialCategory] : ''}`,
      k?.delayedPct == null ? '–' : `${k.delayedPct.toFixed(0)} %`,
      k?.type ? CURVE_TYPE_LABELS[k.type] : (k?.reason ?? '–'),
    ];
  });

  const meansRows = (samples?.results ?? []).map(r => {
    const roi = rois.find(x => x.id === r.roiId);
    return [
      roi?.label ?? `ROI ${r.roiId}`,
      ...r.phases.map(p => (p.mean === null ? '–' : p.mean.toFixed(0))),
    ];
  });

  const html = buildReportDocument({
    header: getPrintHeader(displaySet),
    title: 'Curvas cinéticas (tiempo-intensidad)',
    notice: BETA_NOTICE || undefined,
    sections: [
      {
        kind: 'images',
        images,
        columns: images.length > 1 ? 2 : 1,
        caption: times
          ? 'Realce relativo a la fase basal frente al tiempo de adquisición leído de cada imagen.'
          : 'Realce relativo a la fase basal por índice de fase (los archivos no traen hora distinta por fase).',
      },
      {
        kind: 'table',
        title: 'ROIs',
        columns: ['ROI', 'Radio', 'Basal', 'Realce inicial', 'Tardío', 'Tipo'],
        rows: roiRows,
      },
      ...(meansRows.length
        ? [
            {
              kind: 'table' as const,
              title: 'Media por fase',
              columns: ['ROI', ...phases.map(p => p.label)],
              rows: meansRows,
            },
          ]
        : []),
      {
        kind: 'table',
        title: 'Fases',
        columns: ['Fase', 'Hora (archivo)', 'Tiempo'],
        rows: phaseRows,
      },
      {
        kind: 'notes',
        title: 'Método',
        lines: [
          'Realce inicial = (S₁ − S₀) / S₀ × 100 (lento < 50 %, medio 50–100 %, rápido > 100 %).',
          'Tardío = (Sₙ − S₁) / S₁ × 100: tipo I persistente ≥ +10 %, tipo II meseta, tipo III lavado ≤ −10 %.',
        ],
      },
      ...(samples?.warnings.length
        ? [
            {
              kind: 'notes' as const,
              title: 'Avisos',
              tone: 'warning' as const,
              lines: samples.warnings,
            },
          ]
        : []),
    ],
  });

  await openPrintSheet(html);
}
