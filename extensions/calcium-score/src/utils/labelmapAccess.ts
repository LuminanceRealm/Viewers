import { cache, metaData, imageLoader, Types as csTypes } from '@cornerstonejs/core';
import { segmentation as csToolsSegmentation, Enums as csToolsEnums } from '@cornerstonejs/tools';

import { isCalciumSegmentationId, SEGMENTATION_ID_PREFIX } from '../constants';
import type { AgatstonInput } from './agatston';

const LABELMAP = csToolsEnums.SegmentationRepresentations.Labelmap;

/** Lo mínimo para localizar los datos de la segmentación de calcio de una serie. */
export interface CalciumSegmentationRefs {
  segmentationId: string;
  displaySetInstanceUID: string;
  /** Imágenes derivadas (Uint8) que guardan las etiquetas, una por corte. */
  labelmapImageIds: string[];
  /** Imágenes CT originales, en el mismo orden. */
  referencedImageIds: string[];
}

/**
 * Pila de cortes lista para calcular: las etiquetas se leen y escriben sobre los
 * buffers reales de los labelmaps, así que modificar `labels[k]` modifica la
 * segmentación (hay que avisar con `triggerSegmentationDataModified`).
 */
export interface SliceStack {
  width: number;
  height: number;
  depth: number;
  labels: Uint8Array[];
  /** Lector de HU del corte `k`. */
  huAt: (k: number) => (idx: number) => number;
  /** [fila, columna] en mm. */
  pixelSpacing: [number, number];
  sliceIncrementMm: number;
}

export function getCalciumSegmentationRefs(segmentationId: string): CalciumSegmentationRefs | null {
  if (!isCalciumSegmentationId(segmentationId)) {
    return null;
  }
  const segmentation = csToolsSegmentation.state.getSegmentation(segmentationId);
  const data = segmentation?.representationData?.[LABELMAP] as
    | { imageIds?: string[]; referencedImageIds?: string[] }
    | undefined;

  if (!data?.imageIds?.length || !data.referencedImageIds?.length) {
    return null;
  }
  if (data.imageIds.length !== data.referencedImageIds.length) {
    return null;
  }

  return {
    segmentationId,
    displaySetInstanceUID: segmentationId.slice(SEGMENTATION_ID_PREFIX.length),
    labelmapImageIds: data.imageIds,
    referencedImageIds: data.referencedImageIds,
  };
}

export function findCalciumSegmentationForViewport(
  viewportId: string
): CalciumSegmentationRefs | null {
  const segmentations = csToolsSegmentation.state.getViewportSegmentations(viewportId) || [];
  for (const segmentation of segmentations) {
    const refs = getCalciumSegmentationRefs(segmentation.segmentationId);
    if (refs) {
      return refs;
    }
  }
  return null;
}

/** Imágenes CT que todavía no están en caché y hacen falta para leer HU. */
export function getMissingReferenceImageIds(refs: CalciumSegmentationRefs): string[] {
  return refs.referencedImageIds.filter(imageId => !cache.getImage(imageId));
}

export async function ensureReferenceImagesLoaded(imageIds: string[]): Promise<void> {
  const missing = imageIds.filter(imageId => !cache.getImage(imageId));
  await Promise.all(missing.map(imageId => imageLoader.loadAndCacheImage(imageId)));
}

/**
 * Incremento entre cortes a partir de las posiciones reales de las imágenes
 * (mediana de las distancias consecutivas). Si no hay posiciones, cae al
 * SliceThickness del primer corte.
 */
export function computeSliceIncrementMm(referencedImageIds: string[]): number {
  const positions = referencedImageIds
    .map(imageId => metaData.get('imagePlaneModule', imageId)?.imagePositionPatient)
    .filter(Boolean) as csTypes.Point3[];

  if (positions.length >= 2) {
    const distances: number[] = [];
    for (let n = 1; n < positions.length; n++) {
      const [ax, ay, az] = positions[n - 1];
      const [bx, by, bz] = positions[n];
      distances.push(Math.hypot(bx - ax, by - ay, bz - az));
    }
    distances.sort((a, b) => a - b);
    const median = distances[Math.floor(distances.length / 2)];
    if (median > 0) {
      return median;
    }
  }

  const thickness = metaData.get('imagePlaneModule', referencedImageIds[0])?.sliceThickness;
  return Number(thickness) || 0;
}

function huReader(image: csTypes.IImage): (idx: number) => number {
  const raw = image.getPixelData() as ArrayLike<number>;
  // Si el loader ya aplicó el rescale (preScale), los datos ya están en HU.
  const alreadyScaled = image.preScale?.scaled === true;
  const slope = alreadyScaled ? 1 : (image.slope ?? 1);
  const intercept = alreadyScaled ? 0 : (image.intercept ?? 0);
  return idx => raw[idx] * slope + intercept;
}

/**
 * Arma la pila de cortes. Lanza si falta alguna imagen; el que llama debe
 * haber pasado por `ensureReferenceImagesLoaded` antes.
 */
export function buildSliceStack(refs: CalciumSegmentationRefs): SliceStack {
  const labels: Uint8Array[] = [];
  const huReaders: ((idx: number) => number)[] = [];
  let width = 0;
  let height = 0;
  let pixelSpacing: [number, number] = [0, 0];

  refs.labelmapImageIds.forEach((labelmapImageId, k) => {
    const labelmap = cache.getImage(labelmapImageId);
    const reference = cache.getImage(refs.referencedImageIds[k]);
    if (!labelmap) {
      throw new Error(`Falta el labelmap del corte ${k}`);
    }
    if (!reference) {
      throw new Error(`Falta la imagen CT del corte ${k}`);
    }
    if (k === 0) {
      width = labelmap.columns;
      height = labelmap.rows;
      pixelSpacing = [reference.rowPixelSpacing, reference.columnPixelSpacing];
    } else if (labelmap.columns !== width || labelmap.rows !== height) {
      throw new Error('Los cortes de la serie no tienen las mismas dimensiones');
    }
    labels.push(labelmap.getPixelData() as Uint8Array);
    huReaders.push(huReader(reference));
  });

  return {
    width,
    height,
    depth: labels.length,
    labels,
    huAt: k => huReaders[k],
    pixelSpacing,
    sliceIncrementMm: computeSliceIncrementMm(refs.referencedImageIds),
  };
}

export function toAgatstonInput(stack: SliceStack): AgatstonInput {
  return {
    width: stack.width,
    height: stack.height,
    slices: stack.labels.map((labels, k) => ({ labels, hu: stack.huAt(k) })),
    pixelSpacing: stack.pixelSpacing,
    sliceIncrementMm: stack.sliceIncrementMm,
  };
}
