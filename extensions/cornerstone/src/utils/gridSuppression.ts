/**
 * NUBIX: supresión del patrón de rejilla antidifusora en radiografías.
 *
 * Algunas placas (p. ej. Fujifilm DR-ID 330CL, estudio 1124473) llegan con las
 * líneas de la rejilla grabadas en los píxeles: un patrón periódico muy fino
 * (≈2.5 px). A tamaño real se ve como rayado; al reducir la imagen en pantalla
 * esa frecuencia se "bate" con los píxeles del monitor y aparecen bandas anchas
 * que cambian con el zoom (moiré). Los equipos y las estaciones lo quitan con
 * un filtro de supresión de rejilla; esto es lo mismo:
 *
 * 1. Detección: pico estrecho y fuerte en el espectro del perfil promedio de
 *    columnas (líneas verticales) o de filas (horizontales).
 * 2. Supresión: filtro de muesca adaptativo (demodulación): en cada línea se
 *    estima la amplitud y fase locales de esa única frecuencia con un paso bajo
 *    y se resta. El resto del espectro queda intacto.
 *
 * Funciones puras sobre el arreglo de píxeles, sin dependencias, para jest.
 */

export type GridAxis = 'x' | 'y';

export interface GridPattern {
  /** 'x' = líneas verticales (varía a lo largo de las columnas). */
  axis: GridAxis;
  /** Ciclos por píxel, entre 0 y 0.5. */
  frequency: number;
  /** Altura del pico respecto de la mediana de la banda. */
  strength: number;
}

type Pixels = { length: number; [index: number]: number };

/** Un pico por debajo de esto puede ser anatomía o ruido; la rejilla real da ~100. */
export const MIN_STRENGTH = 25;
/** Las rejillas quedan en la mitad alta del espectro; más abajo hay anatomía. */
const MIN_FREQUENCY = 0.18;
const MIN_SIZE = 256;

/** Media móvil de longitud `size` con los bordes repetidos. */
function boxFilter(src: Float64Array, size: number, dst: Float64Array): void {
  const n = src.length;
  const half = Math.floor(size / 2);
  const at = (i: number) => src[i < 0 ? 0 : i >= n ? n - 1 : i];
  let sum = 0;
  for (let i = -half; i < size - half; i++) {
    sum += at(i);
  }
  for (let i = 0; i < n; i++) {
    dst[i] = sum / size;
    sum += at(i + size - half) - at(i - half);
  }
}

function profile(pixels: Pixels, rows: number, cols: number, axis: GridAxis): Float64Array {
  // Promedio de la mitad central, que es donde está el paciente.
  if (axis === 'x') {
    const out = new Float64Array(cols);
    const r0 = Math.floor(rows / 4);
    const r1 = Math.floor((3 * rows) / 4);
    let count = 0;
    for (let r = r0; r < r1; r += 2) {
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        out[c] += pixels[base + c];
      }
      count++;
    }
    for (let c = 0; c < cols; c++) {
      out[c] /= count;
    }
    return out;
  }
  const out = new Float64Array(rows);
  const c0 = Math.floor(cols / 4);
  const c1 = Math.floor((3 * cols) / 4);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let sum = 0;
    let count = 0;
    for (let c = c0; c < c1; c += 2) {
      sum += pixels[base + c];
      count++;
    }
    out[r] = sum / count;
  }
  return out;
}

/** Busca el pico más fuerte de la banda alta del espectro de un perfil. */
function spectralPeak(signal: Float64Array): { frequency: number; strength: number } | null {
  const trend = new Float64Array(signal.length);
  boxFilter(signal, 31, trend);
  // Se descartan los bordes, donde la media móvil repite valores.
  const margin = Math.min(200, Math.floor(signal.length / 8));
  const n = signal.length - 2 * margin;
  if (n < MIN_SIZE / 2) {
    return null;
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    x[i] = (signal[i + margin] - trend[i + margin]) * hann;
  }

  const kMin = Math.ceil(MIN_FREQUENCY * n);
  const kMax = Math.floor(0.5 * n);
  const mags = new Float64Array(kMax - kMin + 1);
  // Goertzel: la magnitud de cada frecuencia con una sola multiplicación por
  // muestra, sin senos ni cosenos en el bucle (la DFT directa tardaba >1 s en
  // una placa de 4k).
  for (let k = kMin; k <= kMax; k++) {
    const w = (2 * Math.PI * k) / n;
    const coeff = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const s0 = x[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    mags[k - kMin] = Math.sqrt(Math.max(0, power));
  }

  let best = 0;
  for (let i = 1; i < mags.length; i++) {
    if (mags[i] > mags[best]) {
      best = i;
    }
  }
  const sorted = Array.from(mags).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;

  // Interpolación parabólica para afinar la frecuencia entre dos muestras.
  let delta = 0;
  if (best > 0 && best < mags.length - 1) {
    const a = mags[best - 1];
    const b = mags[best];
    const c = mags[best + 1];
    const den = a - 2 * b + c;
    delta = den ? (0.5 * (a - c)) / den : 0;
  }
  return { frequency: (best + kMin + delta) / n, strength: mags[best] / median };
}

/** Devuelve el patrón de rejilla si lo hay, o null. */
export function detectGridPattern(pixels: Pixels, rows: number, cols: number): GridPattern | null {
  if (rows < MIN_SIZE || cols < MIN_SIZE || pixels.length !== rows * cols) {
    return null;
  }
  let found: GridPattern | null = null;
  for (const axis of ['x', 'y'] as GridAxis[]) {
    const peak = spectralPeak(profile(pixels, rows, cols, axis));
    if (peak && peak.strength >= MIN_STRENGTH && (!found || peak.strength > found.strength)) {
      found = { axis, ...peak };
    }
  }
  return found;
}

/**
 * Resta el patrón en el sitio. `minValue`/`maxValue` acotan el resultado al
 * rango original para no cambiar el mínimo y máximo que ya calculó el loader.
 */
export function suppressGridPattern(
  pixels: Pixels,
  rows: number,
  cols: number,
  pattern: GridPattern,
  minValue: number,
  maxValue: number
): void {
  const { axis, frequency } = pattern;
  const length = axis === 'x' ? cols : rows;
  const lines = axis === 'x' ? rows : cols;
  const index = axis === 'x' ? (line, i) => line * cols + i : (line, i) => i * cols + line;

  // Ventana del paso bajo: ~8 periodos, dos pasadas (triangular) para
  // cancelar bien el término al doble de frecuencia.
  const lowpass = Math.max(5, Math.round(8 / frequency));
  const cosT = new Float64Array(length);
  const sinT = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    cosT[i] = Math.cos(2 * Math.PI * frequency * i);
    sinT[i] = Math.sin(2 * Math.PI * frequency * i);
  }

  const line = new Float64Array(length);
  const tmp = new Float64Array(length);
  const trend = new Float64Array(length);
  const inPhase = new Float64Array(length);
  const quad = new Float64Array(length);

  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < length; i++) {
      line[i] = pixels[index(l, i)];
    }
    // Fuera la baja frecuencia antes de demodular, o se filtraría al pico.
    boxFilter(line, 2 * lowpass, tmp);
    boxFilter(tmp, 2 * lowpass, trend);
    for (let i = 0; i < length; i++) {
      const hp = line[i] - trend[i];
      inPhase[i] = hp * cosT[i];
      quad[i] = hp * sinT[i];
    }
    boxFilter(inPhase, lowpass, tmp);
    boxFilter(tmp, lowpass, inPhase);
    boxFilter(quad, lowpass, tmp);
    boxFilter(tmp, lowpass, quad);
    for (let i = 0; i < length; i++) {
      const value = line[i] - 2 * (inPhase[i] * cosT[i] + quad[i] * sinT[i]);
      pixels[index(l, i)] = value < minValue ? minValue : value > maxValue ? maxValue : value;
    }
  }
}
