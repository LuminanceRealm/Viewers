import { cache, imageLoader, metaData } from '@cornerstonejs/core';

import type { Vec3 } from '../constants';
import type { GridAxes } from './archGeometry';

/**
 * La serie CBCT como rejilla regular, leída de las imágenes en caché de
 * cornerstone (no de sus volúmenes, que en este fork pueden ser un sub-rango).
 * Convención: i = columna (rowCos), j = fila (colCos), k = corte a lo largo de
 * la normal (row × col), con los cortes ordenados de menor a mayor.
 *
 * Guarda la referencia al arreglo de píxeles de cada corte: si cornerstone
 * desaloja una imagen de su caché, la reconstrucción sigue teniendo los datos.
 */
export interface VolumeGrid extends GridAxes {
  uid: string;
  imageIds: string[];
  dims: [number, number, number];
  /** [mm por columna, mm por fila, mm entre cortes] */
  spacing: [number, number, number];
  slices: ArrayLike<number>[];
  slope: Float32Array;
  intercept: Float32Array;
  /** +1 si la normal apunta hacia la cabeza (k creciente = superior), −1 si no. */
  upSign: 1 | -1;
  /** Cuánto se aparta la normal del eje cabeza-pies, en grados. */
  tiltDeg: number;
}

const registry = new Map<string, VolumeGrid>();

export function getVolumeGrid(uid: string): VolumeGrid | undefined {
  return registry.get(uid);
}

/** Suelta todas las rejillas (y con ellas, los píxeles de cada serie). */
export function disposeAllVolumeGrids(): void {
  registry.clear();
}

const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];

async function loadAll(imageIds: string[], onProgress?: (done: number, total: number) => void) {
  let done = 0;
  const total = imageIds.length;
  // Por tandas: pedir cientos de cortes a la vez satura el pool de decodificación.
  const BATCH = 24;
  for (let start = 0; start < total; start += BATCH) {
    await Promise.all(
      imageIds.slice(start, start + BATCH).map(async imageId => {
        if (!cache.getImage(imageId)) {
          await imageLoader.loadAndCacheImage(imageId);
        }
        done++;
      })
    );
    onProgress?.(done, total);
  }
}

/**
 * Carga todos los cortes y arma la rejilla. Lanza, con un mensaje para el
 * usuario, si la serie no es una rejilla regular: reconstruir sobre un
 * espaciado mal supuesto daría una imagen de aspecto normal con medidas falsas.
 */
export async function createVolumeGrid(
  uid: string,
  imageIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<VolumeGrid> {
  const existing = registry.get(uid);
  if (existing) {
    return existing;
  }
  if (imageIds.length < 10) {
    throw new Error('La serie tiene muy pocos cortes para reconstruir una panorámica.');
  }

  await loadAll(imageIds, onProgress);

  const iop = metaData.get('imagePlaneModule', imageIds[0])?.imageOrientationPatient;
  if (!iop || iop.length !== 6) {
    throw new Error('La serie no tiene orientación de imagen.');
  }
  const rowCos: Vec3 = [iop[0], iop[1], iop[2]];
  const colCos: Vec3 = [iop[3], iop[4], iop[5]];
  const normal = cross(rowCos, colCos);

  const located = imageIds.map(imageId => {
    const plane = metaData.get('imagePlaneModule', imageId);
    const ipp = plane?.imagePositionPatient as Vec3;
    const orientation = plane?.imageOrientationPatient;
    if (!ipp || !orientation) {
      throw new Error('Hay cortes sin posición de imagen.');
    }
    for (let n = 0; n < 6; n++) {
      if (Math.abs(orientation[n] - iop[n]) > 0.01) {
        throw new Error('Los cortes de la serie no tienen la misma orientación.');
      }
    }
    return { imageId, ipp, d: dot(ipp, normal) };
  });
  located.sort((p, q) => p.d - q.d);

  const gaps: number[] = [];
  for (let n = 1; n < located.length; n++) {
    gaps.push(located[n].d - located[n - 1].d);
  }
  const sortedGaps = [...gaps].sort((p, q) => p - q);
  const zMm = sortedGaps[Math.floor(sortedGaps.length / 2)];
  if (!(zMm > 0)) {
    throw new Error('No se pudo determinar la separación entre cortes.');
  }
  if (gaps.some(gap => Math.abs(gap - zMm) > zMm * 0.1)) {
    throw new Error(
      'La separación entre cortes no es uniforme (faltan cortes o la serie mezcla adquisiciones).'
    );
  }

  const sortedIds = located.map(l => l.imageId);
  const first = cache.getImage(sortedIds[0]);
  const cols = first.columns;
  const rows = first.rows;
  const nz = sortedIds.length;
  const slices: ArrayLike<number>[] = new Array(nz);
  const slope = new Float32Array(nz);
  const intercept = new Float32Array(nz);
  for (let k = 0; k < nz; k++) {
    const image = cache.getImage(sortedIds[k]);
    if (!image) {
      throw new Error('No se pudieron cargar todos los cortes de la serie.');
    }
    if (image.color) {
      throw new Error('La serie es a color; la panorámica necesita una tomografía.');
    }
    if (image.columns !== cols || image.rows !== rows) {
      throw new Error('Los cortes no tienen las mismas dimensiones.');
    }
    slices[k] = image.getPixelData() as ArrayLike<number>;
    const scaled = image.preScale?.scaled === true;
    slope[k] = scaled ? 1 : (image.slope ?? 1);
    intercept[k] = scaled ? 0 : (image.intercept ?? 0);
  }

  const colMm = first.columnPixelSpacing;
  const rowMm = first.rowPixelSpacing;
  if (!(colMm > 0) || !(rowMm > 0)) {
    throw new Error('La serie no tiene tamaño de píxel.');
  }

  const head = normal[2];
  const grid: VolumeGrid = {
    uid,
    imageIds: sortedIds,
    dims: [cols, rows, nz],
    spacing: [colMm, rowMm, zMm],
    origin: located[0].ipp,
    rowCos,
    colCos,
    normal,
    slices,
    slope,
    intercept,
    upSign: head >= 0 ? 1 : -1,
    tiltDeg: (Math.acos(Math.min(1, Math.abs(head))) * 180) / Math.PI,
  };
  registry.set(uid, grid);
  return grid;
}
