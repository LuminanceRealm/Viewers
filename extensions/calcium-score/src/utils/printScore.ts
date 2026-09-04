import { utils as csExtUtils } from '@ohif/extension-cornerstone';

import { ARTERIES, BETA_NOTICE } from '../constants';
import type { CalciumScoreReport } from '../commandsModule';
import { riskCategory } from './agatston';

const { getPrintHeader, captureVisibleViewports, buildReportDocument, openPrintSheet } =
  csExtUtils.printSheet;

export interface PrintScoreOptions {
  displaySet;
  report: CalciumScoreReport;
  viewportIds: string[];
}

/**
 * Hoja imprimible del score de calcio: captura del corte con las lesiones
 * coloreadas, tabla por arteria, total, categoría y avisos.
 */
export default async function printScoreReport({
  displaySet,
  report,
  viewportIds,
}: PrintScoreOptions): Promise<void> {
  const images = await captureVisibleViewports(viewportIds);
  const { result, warnings } = report;
  const category = riskCategory(result.total.score);

  const rows = ARTERIES.map(artery => {
    const s = result.perSegment[artery.segmentIndex];
    return [
      `${artery.short} · ${artery.label}`,
      s.lesions,
      s.volumeMm3.toFixed(1),
      Math.round(s.score),
    ];
  });
  rows.push([
    'Total',
    result.total.lesions,
    result.total.volumeMm3.toFixed(1),
    Math.round(result.total.score),
  ]);

  const html = buildReportDocument({
    header: getPrintHeader(displaySet),
    title: 'Score de calcio coronario (Agatston)',
    notice: BETA_NOTICE || undefined,
    sections: [
      ...(images.length
        ? [
            {
              kind: 'images' as const,
              images,
              columns: 1,
              caption: 'Corte de referencia con las calcificaciones asignadas por arteria.',
            },
          ]
        : []),
      {
        kind: 'keyvalues',
        title: 'Resultado',
        items: [
          ['Agatston total', String(Math.round(result.total.score))],
          ['Categoría', category.label],
          ['Lesiones', String(result.total.lesions)],
          ['Volumen total', `${result.total.volumeMm3.toFixed(1)} mm³`],
          ['Incremento de corte', `${report.sliceIncrementMm.toFixed(2)} mm`],
          [
            'Tamaño de píxel',
            `${report.pixelSpacing[0].toFixed(3)} × ${report.pixelSpacing[1].toFixed(3)} mm`,
          ],
        ],
      },
      {
        kind: 'table',
        title: 'Por arteria',
        columns: ['Arteria', 'Lesiones', 'Volumen (mm³)', 'Agatston'],
        rows,
      },
      {
        kind: 'notes',
        title: 'Método',
        lines: [
          'Umbral de 130 HU; área mínima 1 mm² por lesión y corte; factor de densidad 1–4 según el pico de HU (130–199, 200–299, 300–399, ≥ 400); normalizado a cortes de 3 mm.',
          'Las lesiones se cuentan como componentes conexas en 3D.',
        ],
      },
      ...(warnings.length
        ? [{ kind: 'notes' as const, title: 'Avisos', tone: 'warning' as const, lines: warnings }]
        : []),
    ],
  });

  await openPrintSheet(html);
}
