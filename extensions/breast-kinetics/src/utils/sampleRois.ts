import { cache, imageLoader, metaData, utilities as csUtils } from '@cornerstonejs/core';

import { MOTION_WARN_MM, Vec3 } from '../constants';
import { phaseKey, PhaseState, RoiState } from '../store/useKineticsStore';
import { ImageTime, readImageTime } from './imageTimes';
import type { DisplaySetLike } from './phaseMatching';
import { closestSliceIndex, estimateShiftPx, meanInDisc, PixelImage } from './roiSampling';

export interface PhaseSample {
  displaySetInstanceUID: string;
  imageId: string | null;
  mean: number | null;
  count: number;
  /** Desplazamiento estimado respecto a la fase basal, en mm; null si no se pudo estimar. */
  shiftMm: number | null;
}

export interface RoiSampleResult {
  roiId: number;
  phases: PhaseSample[];
}

export interface StudySamples {
  results: RoiSampleResult[];
  times: Record<string, ImageTime>;
  warnings: string[];
}

interface PhaseGeometry {
  imageIds: string[];
  positions: Vec3[];
  normal: Vec3;
  sliceSpacing: number;
}

function toNumbers(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number);
  }
  if (typeof value === 'string') {
    return value.split('\\').map(Number);
  }
  return [];
}

function phaseGeometry(imageIds: string[]): PhaseGeometry | null {
  if (!imageIds.length) {
    return null;
  }
  const firstPlane = metaData.get('imagePlaneModule', imageIds[0]);
  const iop = toNumbers(firstPlane?.imageOrientationPatient);
  if (iop.length !== 6) {
    return null;
  }
  const [rx, ry, rz, cx, cy, cz] = iop;
  const normal: Vec3 = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
  const entries = imageIds
    .map(imageId => ({
      imageId,
      ipp: toNumbers(metaData.get('imagePlaneModule', imageId)?.imagePositionPatient),
    }))
    .filter(e => e.imageId && e.ipp.length === 3)
    .map(e => ({ ...e, d: e.ipp[0] * normal[0] + e.ipp[1] * normal[1] + e.ipp[2] * normal[2] }))
    .sort((a, b) => a.d - b.d);
  if (entries.length < 1) {
    return null;
  }
  let sliceSpacing = 1;
  if (entries.length > 1) {
    const gaps = entries
      .slice(1)
      .map((e, i) => e.d - entries[i].d)
      .sort((a, b) => a - b);
    sliceSpacing = gaps[Math.floor(gaps.length / 2)] || 1;
  }
  return {
    imageIds: entries.map(e => e.imageId),
    positions: entries.map(e => e.ipp as Vec3),
    normal,
    sliceSpacing,
  };
}

async function loadImage(imageId: string) {
  let image = cache.getImage(imageId);
  if (!image) {
    image = await imageLoader.loadAndCacheImage(imageId);
  }
  return image;
}

function toPixelImage(image): PixelImage {
  const alreadyScaled = image.preScale?.scaled === true;
  return {
    pixels: image.getPixelData(),
    rows: image.rows,
    cols: image.columns,
    slope: alreadyScaled ? 1 : (image.slope ?? 1),
    intercept: alreadyScaled ? 0 : (image.intercept ?? 0),
  };
}

/**
 * Muestrea cada ROI en cada fase activa (en el orden dado): carga sólo el corte
 * más cercano al centro de la ROI, promedia el disco, lee la hora del archivo y
 * estima el desplazamiento respecto a la fase basal.
 */
export async function sampleRois(
  phases: PhaseState[],
  rois: RoiState[],
  getDisplaySet: (uid: string) => DisplaySetLike | undefined
): Promise<StudySamples> {
  const times: Record<string, ImageTime> = {};
  const warnings: string[] = [];
  const results: RoiSampleResult[] = rois.map(roi => ({ roiId: roi.id, phases: [] }));

  const geometries = phases.map(p => {
    const imageIds = p.imageIds?.length
      ? p.imageIds
      : ((getDisplaySet(p.displaySetInstanceUID)?.instances ?? [])
          .map(i => i.imageId as string)
          .filter(Boolean) as string[]);
    return phaseGeometry(imageIds);
  });

  // Imagen basal por ROI, para el aviso de movimiento.
  const baseImages: Record<number, { image: PixelImage; centerRC: [number, number] } | null> = {};

  for (let pi = 0; pi < phases.length; pi++) {
    const phase = phases[pi];
    const geometry = geometries[pi];
    if (!geometry) {
      warnings.push(`${phase.label} no tiene geometría legible.`);
      rois.forEach((roi, ri) =>
        results[ri].phases.push({
          displaySetInstanceUID: phase.displaySetInstanceUID,
          imageId: null,
          mean: null,
          count: 0,
          shiftMm: null,
        })
      );
      continue;
    }

    for (let ri = 0; ri < rois.length; ri++) {
      const roi = rois[ri];
      const k = closestSliceIndex(
        geometry.positions,
        geometry.normal,
        roi.center,
        geometry.sliceSpacing
      );
      const sample: PhaseSample = {
        displaySetInstanceUID: phase.displaySetInstanceUID,
        imageId: null,
        mean: null,
        count: 0,
        shiftMm: null,
      };
      if (k >= 0) {
        const imageId = geometry.imageIds[k];
        try {
          const image = await loadImage(imageId);
          sample.imageId = imageId;
          if (!times[phaseKey(phase)]) {
            times[phaseKey(phase)] = readImageTime(imageId);
          }
          const rc = csUtils.worldToImageCoords(imageId, roi.center);
          if (rc) {
            // worldToImageCoords devuelve [columna, fila]; aquí trabajamos en [fila, columna].
            const centerRC: [number, number] = [rc[1], rc[0]];
            const radiusPx: [number, number] = [
              roi.radiusMm / (image.rowPixelSpacing || 1),
              roi.radiusMm / (image.columnPixelSpacing || 1),
            ];
            const pixelImage = toPixelImage(image);
            const { mean, count } = meanInDisc(pixelImage, centerRC, radiusPx);
            sample.mean = mean;
            sample.count = count;

            if (pi === 0) {
              baseImages[roi.id] = { image: pixelImage, centerRC };
            } else if (baseImages[roi.id]) {
              const shift = estimateShiftPx(baseImages[roi.id]!.image, pixelImage, centerRC);
              if (shift) {
                sample.shiftMm = Math.hypot(
                  shift[0] * (image.rowPixelSpacing || 1),
                  shift[1] * (image.columnPixelSpacing || 1)
                );
              }
            }
          }
        } catch (error) {
          console.warn('sampleRois: no se pudo muestrear', imageId, error);
        }
      }
      results[ri].phases.push(sample);
    }
  }

  results.forEach((r, ri) => {
    const moved = r.phases.filter(p => p.shiftMm !== null && p.shiftMm > MOTION_WARN_MM);
    if (moved.length) {
      const worst = Math.max(...moved.map(p => p.shiftMm as number));
      warnings.push(
        `${rois[ri].label}: desplazamiento estimado de hasta ${worst.toFixed(1)} mm entre fases; la curva puede no ser fiable.`
      );
    }
    if (r.phases.some(p => p.mean !== null && p.count < 4)) {
      warnings.push(`${rois[ri].label}: muy pocos píxeles en la ROI; aumenta el radio.`);
    }
  });

  return { results, times, warnings };
}
