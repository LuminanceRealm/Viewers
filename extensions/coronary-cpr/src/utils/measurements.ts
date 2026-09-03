import type { Vec3 } from '../constants';
import { distance, dot, rotateVecByQuat, sub } from './centerlineGeometry';

export type MeasurementKind = 'length' | 'stenosis';

export interface CprMeasurement {
  id: number;
  kind: MeasurementKind;
  arteryId: number;
  /** Puntos en coordenadas mundo: 2 para regla, 4 para estenosis (referencia, mínimo). */
  points: Vec3[];
}

/** Puntos que necesita cada tipo para quedar completa. */
export const POINTS_REQUIRED: Record<MeasurementKind, number> = { length: 2, stenosis: 4 };

export function lengthMm(points: Vec3[]): number | null {
  if (points.length < 2) {
    return null;
  }
  return distance(points[0], points[1]);
}

export interface StenosisResult {
  referenceMm: number;
  minimalMm: number;
  /** (1 − mínimo / referencia) × 100; null si la referencia es cero. */
  percent: number | null;
}

export function stenosis(points: Vec3[]): StenosisResult | null {
  if (points.length < 4) {
    return null;
  }
  const referenceMm = distance(points[0], points[1]);
  const minimalMm = distance(points[2], points[3]);
  return {
    referenceMm,
    minimalMm,
    percent: referenceMm > 0 ? (1 - minimalMm / referenceMm) * 100 : null,
  };
}

/** Un punto del mundo expresado en el plano de la tira CPR. */
export interface StripCoords {
  /** Distancia desde el primer punto de la centerline, en mm (eje vertical de la tira). */
  distance: number;
  /** Desplazamiento lateral en mm respecto a la centerline (positivo hacia la derecha). */
  lateral: number;
  /** Distancia fuera del plano, en mm; cuanto mayor, menos visible está el punto. */
  offPlane: number;
}

export interface StripGeometry {
  /** xyz por muestra. */
  points: Float32Array;
  /** quat por muestra (tal como se pasa al mapper). */
  orientations: Float32Array;
  /** Distancia acumulada por muestra, con la métrica del modo actual del mapper. */
  distances: ArrayLike<number>;
  /** Si el modo es estirado, todas las muestras usan la orientación de la primera. */
  uniformOrientation?: [number, number, number, number] | null;
}

function sampleAt(geometry: StripGeometry, i: number): Vec3 {
  return [geometry.points[i * 3], geometry.points[i * 3 + 1], geometry.points[i * 3 + 2]];
}

function quatAt(geometry: StripGeometry, i: number): [number, number, number, number] {
  if (geometry.uniformOrientation) {
    return geometry.uniformOrientation;
  }
  return [
    geometry.orientations[i * 4],
    geometry.orientations[i * 4 + 1],
    geometry.orientations[i * 4 + 2],
    geometry.orientations[i * 4 + 3],
  ];
}

/**
 * Proyecta un punto del mundo sobre la tira: muestra de la centerline más
 * cercana, y descomposición del resto en los ejes lateral (u) y fuera de plano (v)
 * de esa muestra. Es la operación inversa a "clic en la tira → punto del mundo".
 */
export function projectToStrip(point: Vec3, geometry: StripGeometry): StripCoords | null {
  const n = geometry.points.length / 3;
  if (n === 0) {
    return null;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = distance(point, sampleAt(geometry, i));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  const q = quatAt(geometry, best);
  const u = rotateVecByQuat([1, 0, 0], q);
  const v = rotateVecByQuat([0, 1, 0], q);
  const rel = sub(point, sampleAt(geometry, best));
  return {
    distance: geometry.distances[best],
    lateral: dot(rel, u),
    offPlane: Math.abs(dot(rel, v)),
  };
}

/**
 * Punto del mundo que corresponde a una posición de la tira: posición de la
 * centerline a esa distancia más el desplazamiento lateral por el eje u.
 */
export function stripToWorld(
  position: Vec3,
  orientation: [number, number, number, number],
  lateral: number
): Vec3 {
  const u = rotateVecByQuat([1, 0, 0], orientation);
  return [position[0] + u[0] * lateral, position[1] + u[1] * lateral, position[2] + u[2] * lateral];
}
