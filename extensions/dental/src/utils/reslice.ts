import { SECTION_THICKNESS_MM, SLAB_RAY_SPACING_MM } from '../constants';
import { Arch, archPointAt } from './archGeometry';

/** Lo que el remuestreo necesita de la rejilla (así se prueba sin cornerstone). */
export interface SliceStack {
  dims: [number, number, number];
  spacing: [number, number, number];
  slices: ArrayLike<number>[];
  slope: ArrayLike<number>;
  intercept: ArrayLike<number>;
  upSign: 1 | -1;
}

/** Imagen reconstruida: fila 0 = lo más superior. NaN = fuera del volumen. */
export interface Raster {
  data: Float32Array;
  width: number;
  height: number;
  /** mm por píxel en horizontal y vertical. */
  pixelW: number;
  pixelH: number;
}

export type Projection = 'avg' | 'max';

/** Rayos paralelos a la normal de los cortes: `perColumn` rayos (a, b en mm) por columna. */
export interface RaySet {
  ab: Float32Array;
  columns: number;
  perColumn: number;
  pixelW: number;
}

/**
 * Proyecta columnas verticales del volumen. Cada rayo es una posición (a, b)
 * fija en el plano de los cortes, así que sus pesos bilineales se calculan una
 * vez y se reutilizan en todos los cortes; por columna se combinan sus rayos
 * (promedio o máximo). Los rayos fuera del volumen no cuentan.
 */
export function sampleColumns(stack: SliceStack, rays: RaySet, projection: Projection): Raster {
  const [nx, ny, nz] = stack.dims;
  const { columns, perColumn, ab } = rays;
  const total = columns * perColumn;

  const index = new Int32Array(total);
  const w00 = new Float32Array(total);
  const w10 = new Float32Array(total);
  const w01 = new Float32Array(total);
  const w11 = new Float32Array(total);
  for (let r = 0; r < total; r++) {
    const fi = ab[2 * r] / stack.spacing[0];
    const fj = ab[2 * r + 1] / stack.spacing[1];
    if (!(fi >= 0 && fj >= 0 && fi <= nx - 1 && fj <= ny - 1)) {
      index[r] = -1;
      continue;
    }
    const i0 = Math.min(nx - 2, Math.floor(fi));
    const j0 = Math.min(ny - 2, Math.floor(fj));
    const di = fi - i0;
    const dj = fj - j0;
    index[r] = j0 * nx + i0;
    w00[r] = (1 - di) * (1 - dj);
    w10[r] = di * (1 - dj);
    w01[r] = (1 - di) * dj;
    w11[r] = di * dj;
  }

  const data = new Float32Array(columns * nz);
  const useMax = projection === 'max';
  for (let k = 0; k < nz; k++) {
    const slice = stack.slices[k];
    const slope = stack.slope[k];
    const intercept = stack.intercept[k];
    const rowStart = (stack.upSign > 0 ? nz - 1 - k : k) * columns;
    for (let col = 0; col < columns; col++) {
      let acc = useMax ? -Infinity : 0;
      let hits = 0;
      const base = col * perColumn;
      for (let n = 0; n < perColumn; n++) {
        const r = base + n;
        const idx = index[r];
        if (idx < 0) {
          continue;
        }
        const v =
          slice[idx] * w00[r] +
          slice[idx + 1] * w10[r] +
          slice[idx + nx] * w01[r] +
          slice[idx + nx + 1] * w11[r];
        if (useMax) {
          if (v > acc) {
            acc = v;
          }
        } else {
          acc += v;
        }
        hits++;
      }
      data[rowStart + col] = hits ? (useMax ? acc : acc / hits) * slope + intercept : NaN;
    }
  }

  return { data, width: columns, height: nz, pixelW: rays.pixelW, pixelH: stack.spacing[2] };
}

/** Panorámica: una columna por muestra del arco, con el grosor repartido a los dos lados. */
export function panoRays(arch: Arch, slabMm: number): RaySet {
  const perColumn = slabMm > 0 ? Math.max(2, Math.round(slabMm / SLAB_RAY_SPACING_MM) + 1) : 1;
  const ab = new Float32Array(arch.count * perColumn * 2);
  let out = 0;
  for (let i = 0; i < arch.count; i++) {
    for (let n = 0; n < perColumn; n++) {
      const o = perColumn === 1 ? 0 : -slabMm / 2 + (slabMm * n) / (perColumn - 1);
      ab[out++] = arch.a[i] + o * arch.na[i];
      ab[out++] = arch.b[i] + o * arch.nb[i];
    }
  }
  return { ab, columns: arch.count, perColumn, pixelW: arch.stepMm };
}

/**
 * Corte transversal en s: plano perpendicular al arco. **Vestibular a la
 * izquierda** de la imagen: la columna 0 está a +ancho/2 por la normal hacia
 * afuera. Promedia SECTION_THICKNESS_MM a lo largo del arco.
 */
export function sectionRays(arch: Arch, s: number, widthMm: number, pixelMm: number): RaySet {
  const p = archPointAt(arch, s);
  const columns = Math.max(2, Math.round(widthMm / pixelMm) + 1);
  const perColumn = 3;
  const ab = new Float32Array(columns * perColumn * 2);
  let out = 0;
  for (let col = 0; col < columns; col++) {
    const o = widthMm / 2 - col * pixelMm;
    for (let n = 0; n < perColumn; n++) {
      const along = ((n - 1) * SECTION_THICKNESS_MM) / 2;
      ab[out++] = p.a + o * p.na + along * p.ta;
      ab[out++] = p.b + o * p.nb + along * p.tb;
    }
  }
  return { ab, columns, perColumn, pixelW: pixelMm };
}

/** Percentiles sobre una muestra de los valores finitos; null si no hay ninguno. */
export function percentiles(data: ArrayLike<number>, fractions: number[]): number[] | null {
  const stride = Math.max(1, Math.floor(data.length / 60000));
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += stride) {
    const v = data[i];
    if (Number.isFinite(v)) {
      sample.push(v);
    }
  }
  if (!sample.length) {
    return null;
  }
  sample.sort((p, q) => p - q);
  return fractions.map(f => sample[Math.min(sample.length - 1, Math.floor(f * sample.length))]);
}

export interface WindowLevel {
  window: number;
  level: number;
}

/** Ventana que abarca del percentil bajo al alto de la imagen. */
export function autoWindow(data: ArrayLike<number>, low = 0.02, high = 0.998): WindowLevel | null {
  const p = percentiles(data, [low, high]);
  if (!p) {
    return null;
  }
  const window = Math.max(1, p[1] - p[0]);
  return { window, level: p[0] + window / 2 };
}

/** RGBA de 8 bits con la ventana aplicada; fuera del volumen queda negro. */
export function toRgba(raster: Raster, wl: WindowLevel): Uint8ClampedArray {
  const { data } = raster;
  const out = new Uint8ClampedArray(data.length * 4);
  const low = wl.level - wl.window / 2;
  const scale = 255 / Math.max(1e-6, wl.window);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const g = Number.isNaN(v) ? 0 : (v - low) * scale;
    const o = i * 4;
    out[o] = g;
    out[o + 1] = g;
    out[o + 2] = g;
    out[o + 3] = 255;
  }
  return out;
}
