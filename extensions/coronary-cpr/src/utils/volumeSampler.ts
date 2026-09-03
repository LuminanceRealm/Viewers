import { cache, imageLoader, metaData, Types as csTypes } from '@cornerstonejs/core';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import type { Vec3 } from '../constants';

export interface IJKBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Acceso a la serie CT como rejilla regular a partir de las imágenes ya en
 * caché, sin pasar por los volúmenes de cornerstone (que en este fork pueden
 * estar recortados a un sub-rango). Convención: i = columna (rowCosines),
 * j = fila (columnCosines), k = corte (normal = row × col), origen en el centro
 * del primer vóxel del primer corte.
 */
export interface VolumeSampler {
  displaySetInstanceUID: string;
  imageIds: string[];
  dims: [number, number, number];
  /** [colMm, rowMm, zMm] */
  spacing: [number, number, number];
  origin: Vec3;
  rowCos: Vec3;
  colCos: Vec3;
  normal: Vec3;
  worldToIJK(p: Vec3): Vec3;
  ijkToWorld(i: number, j: number, k: number): Vec3;
  /** HU del vóxel más cercano; NaN fuera del volumen. */
  huAtIJK(i: number, j: number, k: number): number;
  huAtWorld(p: Vec3): number;
  buildCroppedImageData(box: IJKBox): vtkImageData;
  clampBox(box: IJKBox): IJKBox;
}

const registry = new Map<string, VolumeSampler>();

export function getVolumeSampler(displaySetInstanceUID: string): VolumeSampler | undefined {
  return registry.get(displaySetInstanceUID);
}

export function disposeVolumeSampler(displaySetInstanceUID: string): void {
  registry.delete(displaySetInstanceUID);
}

async function ensureImagesLoaded(imageIds: string[]): Promise<void> {
  const missing = imageIds.filter(id => !cache.getImage(id));
  await Promise.all(missing.map(id => imageLoader.loadAndCacheImage(id)));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function huReader(image: csTypes.IImage): (idx: number) => number {
  const raw = image.getPixelData() as ArrayLike<number>;
  const alreadyScaled = image.preScale?.scaled === true;
  const slope = alreadyScaled ? 1 : (image.slope ?? 1);
  const intercept = alreadyScaled ? 0 : (image.intercept ?? 0);
  return idx => raw[idx] * slope + intercept;
}

/**
 * Carga todas las imágenes de la serie y arma el muestreador. Lanza si la
 * serie no es una rejilla regular (dimensiones distintas o sin posición).
 */
export async function createVolumeSampler(
  displaySetInstanceUID: string,
  imageIds: string[]
): Promise<VolumeSampler> {
  const existing = registry.get(displaySetInstanceUID);
  if (existing) {
    return existing;
  }
  if (imageIds.length < 2) {
    throw new Error('La serie necesita al menos dos cortes.');
  }

  await ensureImagesLoaded(imageIds);

  const firstPlane = metaData.get('imagePlaneModule', imageIds[0]);
  const iop = firstPlane?.imageOrientationPatient;
  if (!iop || iop.length !== 6) {
    throw new Error('La serie no tiene orientación de imagen.');
  }
  const rowCos: Vec3 = [iop[0], iop[1], iop[2]];
  const colCos: Vec3 = [iop[3], iop[4], iop[5]];
  const normal = cross(rowCos, colCos);

  // Ordena por posición a lo largo de la normal, ascendente.
  const withDistance = imageIds.map(imageId => {
    const ipp = metaData.get('imagePlaneModule', imageId)?.imagePositionPatient as Vec3;
    if (!ipp) {
      throw new Error('Hay cortes sin posición de imagen.');
    }
    return { imageId, ipp, d: dot(ipp, normal) };
  });
  withDistance.sort((a, b) => a.d - b.d);

  const gaps: number[] = [];
  for (let n = 1; n < withDistance.length; n++) {
    gaps.push(withDistance[n].d - withDistance[n - 1].d);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const zMm = sortedGaps[Math.floor(sortedGaps.length / 2)];
  if (!(zMm > 0)) {
    throw new Error('No se pudo determinar la separación entre cortes.');
  }

  const sortedIds = withDistance.map(w => w.imageId);
  const first = cache.getImage(sortedIds[0]);
  const cols = first.columns;
  const rows = first.rows;
  const spacing: [number, number, number] = [first.columnPixelSpacing, first.rowPixelSpacing, zMm];
  const origin = withDistance[0].ipp;

  const readers: ((idx: number) => number)[] = new Array(sortedIds.length);
  const readerFor = (k: number) => {
    if (!readers[k]) {
      const image = cache.getImage(sortedIds[k]);
      if (!image) {
        throw new Error(`Falta la imagen del corte ${k}`);
      }
      if (image.columns !== cols || image.rows !== rows) {
        throw new Error('Los cortes no tienen las mismas dimensiones.');
      }
      readers[k] = huReader(image);
    }
    return readers[k];
  };

  const dims: [number, number, number] = [cols, rows, sortedIds.length];

  const worldToIJK = (p: Vec3): Vec3 => {
    const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return [dot(d, rowCos) / spacing[0], dot(d, colCos) / spacing[1], dot(d, normal) / spacing[2]];
  };

  const ijkToWorld = (i: number, j: number, k: number): Vec3 => {
    const a = i * spacing[0];
    const b = j * spacing[1];
    const c = k * spacing[2];
    return [
      origin[0] + a * rowCos[0] + b * colCos[0] + c * normal[0],
      origin[1] + a * rowCos[1] + b * colCos[1] + c * normal[1],
      origin[2] + a * rowCos[2] + b * colCos[2] + c * normal[2],
    ];
  };

  const huAtIJK = (i: number, j: number, k: number): number => {
    const ii = Math.round(i);
    const jj = Math.round(j);
    const kk = Math.round(k);
    if (ii < 0 || jj < 0 || kk < 0 || ii >= cols || jj >= rows || kk >= dims[2]) {
      return NaN;
    }
    return readerFor(kk)(jj * cols + ii);
  };

  const clampBox = (box: IJKBox): IJKBox => ({
    min: [
      Math.max(0, Math.floor(box.min[0])),
      Math.max(0, Math.floor(box.min[1])),
      Math.max(0, Math.floor(box.min[2])),
    ],
    max: [
      Math.min(cols - 1, Math.ceil(box.max[0])),
      Math.min(rows - 1, Math.ceil(box.max[1])),
      Math.min(dims[2] - 1, Math.ceil(box.max[2])),
    ],
  });

  const buildCroppedImageData = (rawBox: IJKBox): vtkImageData => {
    const box = clampBox(rawBox);
    const nx = box.max[0] - box.min[0] + 1;
    const ny = box.max[1] - box.min[1] + 1;
    const nz = box.max[2] - box.min[2] + 1;
    if (nx <= 0 || ny <= 0 || nz <= 0) {
      throw new Error('El recorte del volumen está vacío.');
    }

    const values = new Float32Array(nx * ny * nz);
    let out = 0;
    for (let k = box.min[2]; k <= box.max[2]; k++) {
      const hu = readerFor(k);
      for (let j = box.min[1]; j <= box.max[1]; j++) {
        const rowStart = j * cols;
        for (let i = box.min[0]; i <= box.max[0]; i++) {
          values[out++] = hu(rowStart + i);
        }
      }
    }

    const imageData = vtkImageData.newInstance();
    imageData.setDimensions(nx, ny, nz);
    imageData.setSpacing(spacing);
    imageData.setOrigin(ijkToWorld(box.min[0], box.min[1], box.min[2]));
    imageData.setDirection([...rowCos, ...colCos, ...normal]);
    imageData
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ name: 'HU', numberOfComponents: 1, values }));
    return imageData;
  };

  const sampler: VolumeSampler = {
    displaySetInstanceUID,
    imageIds: sortedIds,
    dims,
    spacing,
    origin,
    rowCos,
    colCos,
    normal,
    worldToIJK,
    ijkToWorld,
    huAtIJK,
    huAtWorld: p => {
      const [i, j, k] = worldToIJK(p);
      return huAtIJK(i, j, k);
    },
    buildCroppedImageData,
    clampBox,
  };

  registry.set(displaySetInstanceUID, sampler);
  return sampler;
}

/** Caja IJK que envuelve puntos mundo con un margen en mm. */
export function boxAroundPoints(sampler: VolumeSampler, points: Vec3[], marginMm: number): IJKBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  points.forEach(p => {
    const ijk = sampler.worldToIJK(p);
    for (let a = 0; a < 3; a++) {
      const m = marginMm / sampler.spacing[a];
      min[a] = Math.min(min[a], ijk[a] - m);
      max[a] = Math.max(max[a], ijk[a] + m);
    }
  });
  return sampler.clampBox({ min, max });
}

export function boxContains(outer: IJKBox, inner: IJKBox): boolean {
  for (let a = 0; a < 3; a++) {
    if (inner.min[a] < outer.min[a] || inner.max[a] > outer.max[a]) {
      return false;
    }
  }
  return true;
}
