import { utils as csExtUtils } from '@ohif/extension-cornerstone';

import { BETA_NOTICE, NERVES, SECTION_THICKNESS_MM } from '../constants';
import type { SeriesDentalState } from '../store/useDentalStore';
import { drawPano, drawSection, rasterToCanvas } from './draw';
import {
  buildOverlays,
  buildPano,
  buildSections,
  buildSeriesArch,
  resolveCursor,
  volumeHeightMm,
} from './model';
import { autoWindow, sampleColumns, sectionRays } from './reslice';
import type { VolumeGrid } from './volumeGrid';

const { getPrintHeader, captureVisibleViewports, buildReportDocument, openPrintSheet } =
  csExtUtils.printSheet;

/** Píxeles por milímetro de las imágenes de la hoja (≈ 200 ppp). */
const PRINT_PX_PER_MM = 8;
/** Ancho útil de la hoja con los márgenes de 12 mm, en el peor caso (A4 y carta). */
const PORTRAIT_WIDTH_MM = 186;
const LANDSCAPE_WIDTH_MM = 255;
const SECTION_GAP_MM = 2;

export interface PrintDentalOptions {
  displaySet;
  grid: VolumeGrid;
  series: SeriesDentalState;
  /** Viewport con el corte axial y el arco, para la captura de referencia. */
  viewportIds: string[];
}

/**
 * Hoja imprimible: panorámica y cortes transversales **a tamaño real**, corte
 * axial de referencia, parámetros y mediciones. Las imágenes se vuelven a
 * reconstruir aquí a resolución de impresión, con los mismos trazos que en
 * pantalla.
 */
export default async function printDentalReport({
  displaySet,
  grid,
  series,
  viewportIds,
}: PrintDentalOptions): Promise<void> {
  const arch = buildSeriesArch(grid, series.arch);
  if (!arch) {
    throw new Error('Traza el arco antes de imprimir.');
  }
  const heightMm = volumeHeightMm(grid);
  const cursorS = resolveCursor(arch, series.cursorS);
  const overlays = buildOverlays(grid, arch, series.nerves, series.rulers, null);

  const panoMmW = arch.count * arch.stepMm;
  const orientation = panoMmW > PORTRAIT_WIDTH_MM ? 'landscape' : 'portrait';
  const pageMm = orientation === 'landscape' ? LANDSCAPE_WIDTH_MM : PORTRAIT_WIDTH_MM;
  // Si ni apaisada cabe, se reduce y la hoja lo dice; la barra de 10 mm sigue siendo cierta.
  const printScale = Math.min(1, pageMm / panoMmW);

  const cellMm = series.sectionWidthMm + arch.stepMm;
  let count = Math.floor((pageMm + SECTION_GAP_MM) / (cellMm * printScale + SECTION_GAP_MM));
  count = Math.max(1, Math.min(7, count % 2 ? count : count - 1));
  const sections = buildSections(
    grid,
    arch,
    cursorS,
    series.sectionSpacingMm,
    series.sectionWidthMm,
    count
  );

  const pano = buildPano(grid, arch, series.slabMm, series.projection);
  const panoWl = series.panoWl ?? autoWindow(pano.data);
  const crossWl =
    series.crossWl ??
    autoWindow(
      sampleColumns(
        grid,
        sectionRays(arch, arch.lengthMm / 2, series.sectionWidthMm, arch.stepMm),
        'avg'
      ).data
    );
  if (!panoWl || !crossWl) {
    throw new Error('La reconstrucción quedó vacía; revisa el trazado del arco.');
  }

  const k = 2;
  const P = PRINT_PX_PER_MM;

  const panoCanvas = document.createElement('canvas');
  panoCanvas.width = Math.round(panoMmW * P);
  panoCanvas.height = Math.round(heightMm * P);
  drawPano(
    panoCanvas.getContext('2d'),
    { scale: P, x: 0, y: 0, w: panoCanvas.width, h: panoCanvas.height },
    {
      grid,
      arch,
      bitmap: rasterToCanvas(pano, panoWl),
      overlays,
      sectionS: sections.map(s => s.s),
      cursorS,
      k,
    }
  );

  const rowMmW = count * cellMm + (count - 1) * SECTION_GAP_MM;
  const rowCanvas = document.createElement('canvas');
  rowCanvas.width = Math.round(rowMmW * P);
  rowCanvas.height = Math.round(heightMm * P);
  const rowCtx = rowCanvas.getContext('2d');
  rowCtx.fillStyle = '#fff';
  rowCtx.fillRect(0, 0, rowCanvas.width, rowCanvas.height);
  sections.forEach((section, i) => {
    drawSection(
      rowCtx,
      {
        scale: P,
        x: i * (cellMm + SECTION_GAP_MM) * P,
        y: 0,
        w: cellMm * P,
        h: heightMm * P,
      },
      {
        grid,
        section,
        bitmap: section.raster ? rasterToCanvas(section.raster, crossWl) : null,
        widthMm: series.sectionWidthMm,
        pixelMm: arch.stepMm,
        overlays,
        isCursor: i === Math.floor(count / 2),
        showScaleBar: i === 0,
        k,
      }
    );
  });

  const viewportImages = await captureVisibleViewports(viewportIds);

  const scaleText =
    printScale === 1
      ? 'Escala 1:1 si se imprime al 100 % (sin «ajustar a la página»); compruébalo midiendo la barra de 10 mm.'
      : `La panorámica no cabe en la hoja a tamaño real: se imprime al ${(printScale * 100).toFixed(0)} %. La barra de 10 mm indica la escala.`;

  const sectionNumber = (s: number | null) =>
    s === null ? '–' : String(Math.round(s / series.sectionSpacingMm));
  const rulerRows = overlays.rulers.map((r, i) => [
    String(i + 1),
    r.view === 'pano' ? 'Panorámica (sobre la curva)' : `Corte ${sectionNumber(r.sectionS)}`,
    `${r.lengthMm.toFixed(1)} mm`,
  ]);
  const nerves = NERVES.filter(n => series.nerves[n.id].length >= 2).map(n => n.label);

  const html = buildReportDocument({
    header: getPrintHeader(displaySet),
    title: 'Panorámica dental y cortes transversales',
    notice: BETA_NOTICE || undefined,
    orientation,
    sections: [
      {
        kind: 'scaled',
        title: 'Panorámica reconstruida',
        images: [
          {
            src: panoCanvas.toDataURL('image/jpeg', 0.92),
            widthMm: panoMmW * printScale,
            heightMm: heightMm * printScale,
          },
        ],
        caption: `R = derecha del paciente. ${scaleText}`,
      },
      {
        kind: 'scaled',
        title: `Cortes transversales (cada ${series.sectionSpacingMm} mm, alrededor del corte ${sectionNumber(cursorS)})`,
        images: [
          {
            src: rowCanvas.toDataURL('image/jpeg', 0.92),
            widthMm: rowMmW * printScale,
            heightMm: heightMm * printScale,
          },
        ],
        caption:
          'V = vestibular, L = lingual o palatino. El número es el del corte sobre el arco; el anillo marca el canal trazado y no su diámetro.',
      },
      ...(viewportImages.length
        ? [
            {
              kind: 'images' as const,
              images: viewportImages,
              columns: 2,
              caption: 'Corte axial de referencia con el arco y la posición de los cortes.',
            },
          ]
        : []),
      {
        kind: 'keyvalues',
        title: 'Parámetros',
        items: [
          ['Longitud del arco', `${arch.lengthMm.toFixed(0)} mm`],
          [
            'Panorámica',
            series.slabMm > 0
              ? `${series.projection === 'max' ? 'MIP' : 'Promedio'} de ${series.slabMm} mm`
              : 'Corte fino',
          ],
          [
            'Cortes transversales',
            `${series.sectionWidthMm} mm de ancho, ${SECTION_THICKNESS_MM} mm de grosor`,
          ],
          ['Vóxel', grid.spacing.map(v => v.toFixed(2)).join(' × ') + ' mm'],
          ['Canal trazado', nerves.length ? nerves.join(', ') : 'no'],
          ['Puntos del arco', String(series.arch.length)],
        ],
      },
      rulerRows.length
        ? {
            kind: 'table',
            title: 'Mediciones',
            columns: ['N.º', 'Vista', 'Longitud'],
            rows: rulerRows,
          }
        : { kind: 'notes', title: 'Mediciones', lines: ['Sin mediciones.'] },
      {
        kind: 'notes',
        tone: 'warning',
        lines: [
          'La panorámica y los cortes dependen del arco trazado: un arco fuera de la arcada deforma la imagen.',
          'El canal mandibular es un trazo manual de apoyo; debe confirmarse en los cortes antes de cualquier decisión.',
          'Los valores de gris de un CBCT no son unidades Hounsfield fiables; no se informa densidad ósea.',
        ],
      },
    ],
  });

  await openPrintSheet(html);
}
