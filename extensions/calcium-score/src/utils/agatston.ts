import {
  HU_THRESHOLD,
  MIN_LESION_AREA_MM2,
  REFERENCE_SLICE_MM,
  ARTERY_INDICES,
} from '../constants';
import { collectComponent3D, collectComponents2D, createVisitedMasks } from './floodFill3D';

/**
 * Un corte del volumen: las etiquetas del labelmap y una función para leer la
 * densidad en HU del mismo píxel de la imagen de referencia.
 */
export interface AgatstonSlice {
  labels: ArrayLike<number>;
  hu: (idx: number) => number;
}

export interface AgatstonInput {
  width: number;
  height: number;
  slices: AgatstonSlice[];
  /** [fila, columna] en mm. */
  pixelSpacing: [number, number];
  /** Distancia entre cortes consecutivos en mm (incremento de reconstrucción). */
  sliceIncrementMm: number;
  /** Índices de segmento que se puntúan (por defecto las cuatro arterias). */
  segmentIndices?: number[];
  huThreshold?: number;
  minLesionAreaMm2?: number;
  referenceSliceMm?: number;
}

export interface SegmentScore {
  segmentIndex: number;
  /** Lesiones contadas como componentes conexas en 3D. */
  lesions: number;
  /** Suma de áreas por corte, en mm². */
  areaMm2: number;
  volumeMm3: number;
  peakHU: number;
  score: number;
}

export interface AgatstonResult {
  perSegment: Record<number, SegmentScore>;
  total: Omit<SegmentScore, 'segmentIndex'>;
  /** Factor `incremento / 3 mm` aplicado a cada lesión. */
  sliceNormalization: number;
}

/**
 * Factor de densidad de Agatston según la atenuación máxima de la lesión.
 * Debajo del umbral no hay lesión, así que devuelve 0.
 */
export function densityFactor(peakHU: number, threshold = HU_THRESHOLD): number {
  if (peakHU < threshold) {
    return 0;
  }
  if (peakHU < 200) {
    return 1;
  }
  if (peakHU < 300) {
    return 2;
  }
  if (peakHU < 400) {
    return 3;
  }
  return 4;
}

export interface RiskCategory {
  key: 'none' | 'minimal' | 'mild' | 'moderate' | 'severe';
  label: string;
}

/** Categorías convencionales de carga de placa según el score total. */
export function riskCategory(total: number): RiskCategory {
  if (total <= 0) {
    return { key: 'none', label: 'Sin calcio detectable' };
  }
  if (total <= 10) {
    return { key: 'minimal', label: 'Carga mínima (1–10)' };
  }
  if (total <= 100) {
    return { key: 'mild', label: 'Carga leve (11–100)' };
  }
  if (total <= 400) {
    return { key: 'moderate', label: 'Carga moderada (101–400)' };
  }
  return { key: 'severe', label: 'Carga severa (> 400)' };
}

function emptyScore(segmentIndex: number): SegmentScore {
  return { segmentIndex, lesions: 0, areaMm2: 0, volumeMm3: 0, peakHU: -Infinity, score: 0 };
}

/**
 * Calcula el score de Agatston por segmento y total.
 *
 * Por cada corte y cada arteria se buscan las componentes conexas (8-vecinos) del
 * labelmap; cada una es una lesión en ese corte. Se descartan las que no alcanzan
 * el área mínima, y las demás aportan `área × factor(pico HU) × (incremento / 3 mm)`.
 * El número de lesiones se cuenta aparte en 3D, para no contar una misma placa
 * una vez por corte.
 */
export function computeAgatston(input: AgatstonInput): AgatstonResult {
  const {
    width,
    height,
    slices,
    pixelSpacing,
    sliceIncrementMm,
    segmentIndices = ARTERY_INDICES,
    huThreshold = HU_THRESHOLD,
    minLesionAreaMm2 = MIN_LESION_AREA_MM2,
    referenceSliceMm = REFERENCE_SLICE_MM,
  } = input;

  const pixelAreaMm2 = pixelSpacing[0] * pixelSpacing[1];
  const voxelVolumeMm3 = pixelAreaMm2 * sliceIncrementMm;
  const sliceNormalization = sliceIncrementMm / referenceSliceMm;

  const perSegment: Record<number, SegmentScore> = {};
  segmentIndices.forEach(index => {
    perSegment[index] = emptyScore(index);
  });

  slices.forEach(({ labels, hu }) => {
    segmentIndices.forEach(segmentIndex => {
      const components = collectComponents2D(labels, width, height, v => v === segmentIndex);
      if (!components.length) {
        return;
      }
      const acc = perSegment[segmentIndex];

      components.forEach(indices => {
        const areaMm2 = indices.length * pixelAreaMm2;
        // El volumen cuenta todo lo marcado; el score sólo lo que pasa el área mínima.
        acc.volumeMm3 += indices.length * voxelVolumeMm3;

        let peak = -Infinity;
        for (let n = 0; n < indices.length; n++) {
          const value = hu(indices[n]);
          if (value > peak) {
            peak = value;
          }
        }
        if (peak > acc.peakHU) {
          acc.peakHU = peak;
        }

        if (areaMm2 < minLesionAreaMm2) {
          return;
        }
        const factor = densityFactor(peak, huThreshold);
        if (factor === 0) {
          return;
        }
        acc.areaMm2 += areaMm2;
        acc.score += areaMm2 * factor * sliceNormalization;
      });
    });
  });

  // Conteo de lesiones en 3D: cada componente conexa de un mismo segmento es una placa.
  const grid = {
    width,
    height,
    depth: slices.length,
    get: (k: number, idx: number) => slices[k].labels[idx],
  };
  const sliceSize = width * height;
  segmentIndices.forEach(segmentIndex => {
    const visited = createVisitedMasks(slices.length);
    let lesions = 0;
    for (let k = 0; k < slices.length; k++) {
      const labels = slices[k].labels;
      for (let idx = 0; idx < sliceSize; idx++) {
        if (labels[idx] !== segmentIndex) {
          continue;
        }
        const mask = visited[k];
        if (mask && mask[idx]) {
          continue;
        }
        const component = collectComponent3D(grid, k, idx, v => v === segmentIndex, visited);
        if (component.length) {
          lesions++;
        }
      }
    }
    perSegment[segmentIndex].lesions = lesions;
  });

  const total = Object.values(perSegment).reduce(
    (sum, s) => ({
      lesions: sum.lesions + s.lesions,
      areaMm2: sum.areaMm2 + s.areaMm2,
      volumeMm3: sum.volumeMm3 + s.volumeMm3,
      peakHU: Math.max(sum.peakHU, s.peakHU),
      score: sum.score + s.score,
    }),
    { lesions: 0, areaMm2: 0, volumeMm3: 0, peakHU: -Infinity, score: 0 }
  );

  return { perSegment, total, sliceNormalization };
}
