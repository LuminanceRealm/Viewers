import {
  DERIVED_DESCRIPTION_REGEX,
  GEOMETRY_ORIENTATION_TOL,
  GEOMETRY_POSITION_TOL_MM,
  GEOMETRY_SPACING_TOL_MM,
  Vec3,
} from '../constants';

/** Lo que necesitamos de un display set de imágenes para emparejar fases. */
export interface DisplaySetLike {
  displaySetInstanceUID: string;
  StudyInstanceUID?: string;
  SeriesNumber?: number | string;
  SeriesDescription?: string;
  Modality?: string;
  instances?: InstanceLike[];
}

export interface InstanceLike {
  imageId?: string;
  FrameOfReferenceUID?: string;
  Rows?: number | string;
  Columns?: number | string;
  PixelSpacing?: (number | string)[] | string;
  ImageOrientationPatient?: (number | string)[] | string;
  ImagePositionPatient?: (number | string)[] | string;
  ImageType?: string[] | string;
  InstanceNumber?: number | string;
}

export interface GeometrySummary {
  frameOfReference: string;
  rows: number;
  cols: number;
  pixelSpacing: [number, number];
  orientation: number[];
  firstPosition: Vec3;
  lastPosition: Vec3;
  count: number;
}

export interface PhaseCandidate {
  displaySetInstanceUID: string;
  seriesNumber: number;
  description: string;
  imageCount: number;
  /** Sustracción, MIP u otra serie derivada: candidata pero desactivada por defecto. */
  derived: boolean;
  /** Imágenes de esta fase (toda la serie, o un subconjunto si la serie es multifase). */
  imageIds: string[];
  /** Índice de fase dentro de una serie multifase; undefined si la fase es una serie entera. */
  phaseIndex?: number;
  /** Texto corto para el panel. */
  label: string;
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

function toStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    return value.split('\\');
  }
  return [];
}

function positionAlongNormal(ipp: number[], orientation: number[]): number {
  const [rx, ry, rz, cx, cy, cz] = orientation;
  const n = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
  return ipp[0] * n[0] + ipp[1] * n[1] + ipp[2] * n[2];
}

/** Resume la geometría de la serie; null si falta algo esencial. */
export function summarizeGeometry(displaySet: DisplaySetLike): GeometrySummary | null {
  const instances = displaySet.instances ?? [];
  if (!instances.length) {
    return null;
  }
  const first = instances[0];
  const orientation = toNumbers(first.ImageOrientationPatient);
  const pixelSpacing = toNumbers(first.PixelSpacing);
  if (orientation.length !== 6 || pixelSpacing.length < 2) {
    return null;
  }
  const positions = instances
    .map(inst => toNumbers(inst.ImagePositionPatient))
    .filter(p => p.length === 3);
  if (positions.length !== instances.length) {
    return null;
  }
  const sorted = [...positions].sort(
    (a, b) => positionAlongNormal(a, orientation) - positionAlongNormal(b, orientation)
  );
  return {
    frameOfReference: String(first.FrameOfReferenceUID ?? ''),
    rows: Number(first.Rows),
    cols: Number(first.Columns),
    pixelSpacing: [pixelSpacing[0], pixelSpacing[1]],
    orientation,
    firstPosition: sorted[0] as Vec3,
    lastPosition: sorted[sorted.length - 1] as Vec3,
    count: instances.length,
  };
}

function near(a: number[], b: number[], tol: number): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

export function sameGeometry(a: GeometrySummary, b: GeometrySummary): boolean {
  return (
    a.frameOfReference === b.frameOfReference &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.count === b.count &&
    near(a.pixelSpacing, b.pixelSpacing, GEOMETRY_SPACING_TOL_MM) &&
    near(a.orientation, b.orientation, GEOMETRY_ORIENTATION_TOL) &&
    near(a.firstPosition, b.firstPosition, GEOMETRY_POSITION_TOL_MM) &&
    near(a.lastPosition, b.lastPosition, GEOMETRY_POSITION_TOL_MM)
  );
}

export function isDerivedSeries(displaySet: DisplaySetLike): boolean {
  const imageType = toStrings(displaySet.instances?.[0]?.ImageType);
  if (imageType.some(t => t.toUpperCase() === 'DERIVED')) {
    return true;
  }
  return DERIVED_DESCRIPTION_REGEX.test(displaySet.SeriesDescription ?? '');
}

/**
 * Una serie dinámica puede venir como una sola serie con todas las fases
 * (Philips: 6 × 150 cortes en "Perfusion_Axial"). Se detecta porque cada
 * posición de corte se repite el mismo número de veces; dentro de cada posición
 * el orden temporal es el de InstanceNumber.
 */
export function splitSeriesIntoPhases(displaySet: DisplaySetLike): PhaseCandidate[] {
  const instances = displaySet.instances ?? [];
  const groups = new Map<string, InstanceLike[]>();
  for (const inst of instances) {
    const ipp = toNumbers(inst.ImagePositionPatient);
    if (ipp.length !== 3 || !inst.imageId) {
      return [];
    }
    const key = ipp.map(v => v.toFixed(1)).join('/');
    const list = groups.get(key) ?? [];
    list.push(inst);
    groups.set(key, list);
  }
  const sizes = new Set(Array.from(groups.values()).map(g => g.length));
  if (sizes.size !== 1) {
    return [];
  }
  const phaseCount = Array.from(sizes)[0];
  if (phaseCount < 2 || groups.size < 2) {
    return [];
  }
  const byInstanceNumber = (a: InstanceLike, b: InstanceLike) =>
    Number(a.InstanceNumber ?? 0) - Number(b.InstanceNumber ?? 0);
  const phases: string[][] = Array.from({ length: phaseCount }, () => []);
  groups.forEach(list => {
    [...list].sort(byInstanceNumber).forEach((inst, t) => phases[t].push(inst.imageId as string));
  });
  const seriesNumber = Number(displaySet.SeriesNumber) || 0;
  return phases.map((imageIds, t) => ({
    displaySetInstanceUID: displaySet.displaySetInstanceUID,
    seriesNumber,
    description: displaySet.SeriesDescription ?? '',
    imageCount: imageIds.length,
    derived: false,
    imageIds,
    phaseIndex: t,
    label: `Fase ${t + 1} · S${seriesNumber}`,
  }));
}

/**
 * Fases candidatas. Si la serie de referencia es multifase, sus fases; si no,
 * las series del mismo estudio y modalidad con geometría idéntica (la referencia
 * incluida). Sin orden temporal todavía: el orden se decide con los tiempos
 * leídos del archivo, que aquí no están.
 */
export function findPhaseCandidates(
  displaySets: DisplaySetLike[],
  reference: DisplaySetLike
): PhaseCandidate[] {
  const intraSeries = splitSeriesIntoPhases(reference);
  if (intraSeries.length) {
    return intraSeries;
  }
  const refGeometry = summarizeGeometry(reference);
  if (!refGeometry) {
    return [];
  }
  return displaySets
    .filter(ds => ds.StudyInstanceUID === reference.StudyInstanceUID)
    .filter(ds => (ds.Modality ?? '') === (reference.Modality ?? ''))
    .filter(ds => {
      const g = summarizeGeometry(ds);
      return g && sameGeometry(g, refGeometry);
    })
    .map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      seriesNumber: Number(ds.SeriesNumber) || 0,
      description: ds.SeriesDescription ?? '',
      imageCount: ds.instances?.length ?? 0,
      derived:
        ds.displaySetInstanceUID === reference.displaySetInstanceUID ? false : isDerivedSeries(ds),
      imageIds: (ds.instances ?? []).map(i => i.imageId as string).filter(Boolean),
      label: `S${Number(ds.SeriesNumber) || 0} ${ds.SeriesDescription ?? ''}`.trim(),
    }));
}

/** `HHMMSS.FFFFFF` (o `HHMMSS`, `HHMM`) → segundos desde medianoche; null si no parsea. */
export function parseDicomTime(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  const match = /^(\d{2})(\d{2})?(\d{2})?(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) {
    return null;
  }
  const h = Number(match[1]);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  const frac = match[4] ? Number(`0.${match[4]}`) : 0;
  if (h > 23 || m > 59 || s > 60) {
    return null;
  }
  return h * 3600 + m * 60 + s + frac;
}

export interface OrderablePhase {
  displaySetInstanceUID: string;
  seriesNumber: number;
  phaseIndex?: number;
  /** Segundos desde medianoche leídos del archivo; null si no vinieron. */
  acquisitionSeconds: number | null;
}

/**
 * Orden temporal: por hora de adquisición cuando todas las fases la traen y no
 * son todas iguales; si no, por número de serie.
 */
export function orderPhases<T extends OrderablePhase>(phases: T[]): T[] {
  const times = phases.map(p => p.acquisitionSeconds);
  const usable =
    times.every(t => t !== null) &&
    new Set(times.map(t => Math.round((t as number) * 1000))).size > 1;
  return [...phases].sort((a, b) => {
    if (usable) {
      const d = (a.acquisitionSeconds as number) - (b.acquisitionSeconds as number);
      if (d !== 0) {
        return d;
      }
    }
    return a.seriesNumber - b.seriesNumber || (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0);
  });
}

/**
 * Eje de tiempo en segundos relativos a la primera fase, o null si las horas no
 * están o son todas iguales (entonces se grafica por índice de fase).
 * Corrige el cruce de medianoche.
 */
export function timeAxis(seconds: (number | null)[]): number[] | null {
  if (!seconds.length || seconds.some(s => s === null)) {
    return null;
  }
  const values = seconds as number[];
  const distinct = new Set(values.map(v => Math.round(v * 1000)));
  if (distinct.size < 2) {
    return null;
  }
  const t0 = values[0];
  return values.map(v => {
    let dt = v - t0;
    if (dt < -12 * 3600) {
      dt += 24 * 3600;
    }
    return dt;
  });
}
