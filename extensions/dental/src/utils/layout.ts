import { MAX_SECTIONS } from '../constants';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DockLayout {
  pano: Box;
  sections: Box[];
}

const GAP = 6;

function oddAtMost(n: number): number {
  const capped = Math.max(1, Math.min(MAX_SECTIONS, Math.floor(n)));
  return capped % 2 ? capped : capped - 1;
}

/**
 * Reparte la franja entre la panorámica y los cortes transversales. En
 * pantallas anchas van lado a lado y a la **misma escala** (un milímetro mide
 * lo mismo en las dos vistas); en angostas (teléfono), la panorámica arriba y
 * los cortes abajo. El número de cortes es impar, entre 1 y MAX_SECTIONS.
 */
export function layoutDock(
  width: number,
  height: number,
  panoMm: { w: number; h: number },
  sectionMm: { w: number; h: number }
): DockLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  if (w < 640) {
    const panoH = Math.min(h * 0.55, (w * panoMm.h) / panoMm.w);
    const rowY = panoH + GAP;
    const rowH = Math.max(1, h - rowY);
    const cellW = (rowH * sectionMm.w) / sectionMm.h;
    const count = oddAtMost((w + GAP) / (cellW + GAP));
    const used = count * cellW + (count - 1) * GAP;
    const fitW = Math.min(cellW, w);
    const startX = Math.max(0, (w - used) / 2);
    return {
      pano: { x: 0, y: 0, w, h: panoH },
      sections: Array.from({ length: count }, (_, i) => ({
        x: startX + i * (cellW + GAP),
        y: rowY,
        w: fitW,
        h: rowH,
      })),
    };
  }

  // Lado a lado y todo a una sola escala. Más cortes encogen la panorámica, así
  // que se toma el mayor número que conserve al menos 3/4 de la escala máxima;
  // tres cortes se aceptan aunque cuesten hasta la mitad.
  const maxScale = h / Math.max(panoMm.h, sectionMm.h);
  const scaleFor = (n: number) => Math.min(maxScale, (w - n * GAP) / (panoMm.w + n * sectionMm.w));
  let count = 1;
  for (let n = MAX_SECTIONS % 2 ? MAX_SECTIONS : MAX_SECTIONS - 1; n >= 3; n -= 2) {
    const ratio = scaleFor(n) / maxScale;
    if (ratio >= 0.75 || (n === 3 && ratio >= 0.5)) {
      count = n;
      break;
    }
  }
  const scale = scaleFor(count);
  const panoW = panoMm.w * scale;
  const cellW = sectionMm.w * scale;
  const startX = Math.max(0, (w - (panoW + count * (cellW + GAP))) / 2);
  return {
    pano: { x: startX, y: 0, w: panoW, h },
    sections: Array.from({ length: count }, (_, i) => ({
      x: startX + panoW + GAP + i * (cellW + GAP),
      y: 0,
      w: cellW,
      h,
    })),
  };
}
