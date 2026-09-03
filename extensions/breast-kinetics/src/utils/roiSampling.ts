import type { Vec3 } from '../constants';

/** Imagen 2D mínima para muestrear: valores crudos más el rescale. */
export interface PixelImage {
  pixels: ArrayLike<number>;
  rows: number;
  cols: number;
  slope?: number;
  intercept?: number;
}

/**
 * Media de los píxeles dentro de una elipse centrada en `[fila, columna]` con
 * radios en píxeles (uno por eje, porque el espaciado puede ser anisótropo).
 * Devuelve también el conteo para que el llamador detecte ROIs vacías.
 */
export function meanInDisc(
  image: PixelImage,
  centerRC: [number, number],
  radiusPx: [number, number]
): { mean: number | null; count: number } {
  const { pixels, rows, cols } = image;
  const slope = image.slope ?? 1;
  const intercept = image.intercept ?? 0;
  const [cr, cc] = centerRC;
  const [rr, rc] = radiusPx;
  if (!(rr > 0) || !(rc > 0)) {
    return { mean: null, count: 0 };
  }
  const r0 = Math.max(0, Math.floor(cr - rr));
  const r1 = Math.min(rows - 1, Math.ceil(cr + rr));
  const c0 = Math.max(0, Math.floor(cc - rc));
  const c1 = Math.min(cols - 1, Math.ceil(cc + rc));
  let sum = 0;
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    const dy = (r - cr) / rr;
    for (let c = c0; c <= c1; c++) {
      const dx = (c - cc) / rc;
      if (dx * dx + dy * dy <= 1) {
        sum += pixels[r * cols + c] * slope + intercept;
        count++;
      }
    }
  }
  return { mean: count ? sum / count : null, count };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Índice del corte cuya posición está más cerca del punto a lo largo de la
 * normal. Devuelve -1 si el más cercano queda a más de `maxDistanceMm`.
 */
export function closestSliceIndex(
  positions: Vec3[],
  normal: Vec3,
  point: Vec3,
  maxDistanceMm = Infinity
): number {
  const target = dot(point, normal);
  let best = -1;
  let bestDistance = Infinity;
  positions.forEach((p, i) => {
    const d = Math.abs(dot(p, normal) - target);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return bestDistance <= maxDistanceMm ? best : -1;
}

/**
 * Desplazamiento (filas, columnas) en píxeles que mejor alinea un parche de
 * `other` con el mismo parche de `base`, por suma de diferencias absolutas
 * sobre parches centrados en su media (el realce cambia el nivel, no la forma).
 * Devuelve null si el parche no cabe en la imagen.
 */
export function estimateShiftPx(
  base: PixelImage,
  other: PixelImage,
  centerRC: [number, number],
  halfSize = 12,
  search = 8
): [number, number] | null {
  const { rows, cols } = base;
  if (other.rows !== rows || other.cols !== cols) {
    return null;
  }
  const cr = Math.round(centerRC[0]);
  const cc = Math.round(centerRC[1]);
  if (
    cr - halfSize - search < 0 ||
    cc - halfSize - search < 0 ||
    cr + halfSize + search >= rows ||
    cc + halfSize + search >= cols
  ) {
    return null;
  }

  const size = halfSize * 2 + 1;
  const patch = (img: PixelImage, dr: number, dc: number): Float64Array => {
    const out = new Float64Array(size * size);
    let sum = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = img.pixels[(cr - halfSize + r + dr) * cols + (cc - halfSize + c + dc)];
        out[r * size + c] = v;
        sum += v;
      }
    }
    const mean = sum / out.length;
    for (let i = 0; i < out.length; i++) {
      out[i] -= mean;
    }
    return out;
  };

  const ref = patch(base, 0, 0);
  let best: [number, number] = [0, 0];
  let bestScore = Infinity;
  for (let dr = -search; dr <= search; dr++) {
    for (let dc = -search; dc <= search; dc++) {
      const cand = patch(other, dr, dc);
      let sad = 0;
      for (let i = 0; i < ref.length; i++) {
        sad += Math.abs(ref[i] - cand[i]);
      }
      if (sad < bestScore) {
        bestScore = sad;
        best = [dr, dc];
      }
    }
  }
  return best;
}
