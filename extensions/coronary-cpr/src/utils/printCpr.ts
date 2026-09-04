import { utils as csExtUtils } from '@ohif/extension-cornerstone';

import { ARTERIES, BETA_NOTICE, arteryById } from '../constants';
import type { SeriesCprState } from '../store/useCprStore';
import { lengthMm, stenosis } from './measurements';

const { getPrintHeader, captureVisibleViewports, buildReportDocument, openPrintSheet } =
  csExtUtils.printSheet;

export interface PrintCprOptions {
  displaySet;
  series: SeriesCprState;
  /** PNG de la tira con las mediciones encima (de `CprViewHandle.captureStrip`). */
  stripImage: string | null;
  vesselLengthMm: number | null;
  /** Viewports a capturar con el trazado (normalmente el activo). */
  viewportIds: string[];
}

/**
 * Hoja imprimible del CPR: tira con mediciones, captura del viewport con el
 * trazado, parámetros y lista de mediciones. Se abre en el diálogo de
 * impresión del navegador, desde donde se guarda como PDF.
 */
export default async function printCprReport({
  displaySet,
  series,
  stripImage,
  vesselLengthMm,
  viewportIds,
}: PrintCprOptions): Promise<void> {
  const artery = arteryById(series.activeArtery);
  const viewportImages = await captureVisibleViewports(viewportIds);
  const images = [stripImage, ...viewportImages].filter(Boolean) as string[];

  const measurements = series.measurements.filter(m => m.arteryId === series.activeArtery);
  const rows = measurements.map(m => {
    if (m.kind === 'length') {
      const l = lengthMm(m.points);
      return ['Regla', l === null ? '–' : `${l.toFixed(1)} mm`, '', ''];
    }
    const s = stenosis(m.points);
    return [
      'Estenosis',
      s?.percent == null ? '–' : `${s.percent.toFixed(0)} %`,
      s ? `${s.referenceMm.toFixed(1)} mm` : '',
      s ? `${s.minimalMm.toFixed(1)} mm` : '',
    ];
  });

  const otherArteries = ARTERIES.filter(
    a => a.id !== series.activeArtery && (series.arteries[a.id] ?? []).length >= 2
  ).map(a => a.short);

  const html = buildReportDocument({
    header: getPrintHeader(displaySet),
    title: `CPR coronario · ${artery?.label ?? ''}`,
    notice: BETA_NOTICE || undefined,
    sections: [
      {
        kind: 'images',
        images,
        columns: images.length > 1 ? 2 : 1,
        caption:
          'Izquierda: reformateo curvo de la arteria trazada (primer punto arriba). Derecha: corte de referencia con el trazado.',
      },
      {
        kind: 'keyvalues',
        title: 'Parámetros',
        items: [
          ['Arteria', `${artery?.short ?? ''} · ${artery?.label ?? ''}`],
          ['Puntos de trazado', String((series.arteries[series.activeArtery] ?? []).length)],
          ['Longitud del vaso', vesselLengthMm === null ? '–' : `${vesselLengthMm.toFixed(0)} mm`],
          ['Ancho del plano', `${series.widthMm} mm`],
          ['Giro', `${series.angleDeg}°`],
          ['Modo', series.mode === 'stretched' ? 'Estirado' : 'Recto'],
          ['Ventana', `W ${Math.round(series.window)} · L ${Math.round(series.level)}`],
          ['Otras arterias trazadas', otherArteries.length ? otherArteries.join(', ') : 'ninguna'],
        ],
      },
      rows.length
        ? {
            kind: 'table',
            title: 'Mediciones sobre la tira (longitudes reales en 3D)',
            columns: ['Tipo', 'Valor', 'Referencia', 'Mínimo'],
            rows,
          }
        : { kind: 'notes', title: 'Mediciones', lines: ['Sin mediciones sobre la tira.'] },
      {
        kind: 'notes',
        tone: 'warning',
        lines: [
          'La tira depende de la calidad del trazado: un punto fuera del vaso produce una falsa estenosis.',
          'Las mediciones son de apoyo; la interpretación es responsabilidad del profesional.',
        ],
      },
    ],
  });

  await openPrintSheet(html);
}
