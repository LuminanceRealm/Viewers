import type { Vec3 } from '../constants';
import type { OrientedCenterline } from './buildCenterlinePolyData';

/** Marco ortonormal en un punto: t = tangente, (u, v) = plano transversal. */
export interface Frame {
  t: Vec3;
  u: Vec3;
  v: Vec3;
}

const EPS = 1e-9;

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/** Longitud de arco poligonal. */
export function arcLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Catmull-Rom centrípeta (alpha = 0.5) entre p1 y p2 con vecinos p0 y p3.
 * La parametrización centrípeta evita bucles y cúspides con puntos desiguales.
 */
function catmullRomSegment(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, samples: number): Vec3[] {
  const alpha = 0.5;
  const dt = (a: Vec3, b: Vec3) => Math.max(Math.pow(distance(a, b), alpha), 1e-4);
  const t0 = 0;
  const t1 = t0 + dt(p0, p1);
  const t2 = t1 + dt(p1, p2);
  const t3 = t2 + dt(p2, p3);

  const lerp = (a: Vec3, b: Vec3, ta: number, tb: number, t: number): Vec3 => {
    if (Math.abs(tb - ta) < EPS) {
      return a;
    }
    const w = (t - ta) / (tb - ta);
    return add(scale(a, 1 - w), scale(b, w));
  };

  const out: Vec3[] = [];
  for (let s = 0; s < samples; s++) {
    const t = t1 + ((t2 - t1) * s) / samples;
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
}

/**
 * Pasa una spline por los puntos de control y la remuestrea a paso uniforme en
 * longitud de arco. Con menos de dos puntos devuelve una copia; con dos, la
 * recta entre ellos.
 */
export function resampleCatmullRom(points: Vec3[], stepMm: number): Vec3[] {
  if (points.length < 2) {
    return points.map(p => [...p] as Vec3);
  }
  const step = Math.max(stepMm, 1e-3);

  // Densificar: ~ 8 muestras por mm de cada segmento, con extremos duplicados.
  const dense: Vec3[] = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const segLen = distance(p1, p2);
    const samples = Math.max(4, Math.ceil((segLen / step) * 8));
    dense.push(...catmullRomSegment(p0, p1, p2, p3, samples));
  }
  dense.push([...points[n - 1]] as Vec3);

  // Remuestrear por longitud de arco.
  const out: Vec3[] = [dense[0]];
  let carried = 0;
  for (let i = 1; i < dense.length; i++) {
    let a = dense[i - 1];
    const b = dense[i];
    let segLen = distance(a, b);
    while (carried + segLen >= step) {
      const need = step - carried;
      const w = need / segLen;
      const p = add(scale(a, 1 - w), scale(b, w));
      out.push(p);
      a = p;
      segLen -= need;
      carried = 0;
    }
    carried += segLen;
  }
  const last = dense[dense.length - 1];
  if (distance(out[out.length - 1], last) > step * 0.25) {
    out.push(last);
  }
  return out;
}

function anyPerpendicular(t: Vec3): Vec3 {
  // Elige el eje mundo menos alineado con t para que u sea estable.
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  let best = axes[0];
  let bestDot = Infinity;
  axes.forEach(axis => {
    const d = Math.abs(dot(axis, t));
    if (d < bestDot) {
      bestDot = d;
      best = axis;
    }
  });
  return normalize(cross(t, cross(best, t)));
}

/**
 * Marcos de rotación mínima (método de doble reflexión, Wang et al. 2008):
 * el plano transversal gira lo menos posible de un punto al siguiente, así el
 * CPR no da vueltas sobre sí mismo aunque el vaso serpentee.
 */
export function rotationMinimizingFrames(samples: Vec3[]): Frame[] {
  const n = samples.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    const t: Vec3 = [0, 0, 1];
    const u = anyPerpendicular(t);
    return [{ t, u, v: cross(t, u) }];
  }

  const tangents: Vec3[] = samples.map((p, i) => {
    if (i === 0) {
      return normalize(sub(samples[1], samples[0]));
    }
    if (i === n - 1) {
      return normalize(sub(samples[n - 1], samples[n - 2]));
    }
    return normalize(sub(samples[i + 1], samples[i - 1]));
  });
  // Tangentes degeneradas (puntos repetidos): heredar la anterior.
  for (let i = 0; i < n; i++) {
    if (length(tangents[i]) < 0.5) {
      tangents[i] = i > 0 ? tangents[i - 1] : [0, 0, 1];
    }
  }

  const frames: Frame[] = [];
  let u = anyPerpendicular(tangents[0]);
  frames.push({ t: tangents[0], u, v: cross(tangents[0], u) });

  for (let i = 0; i < n - 1; i++) {
    const v1 = sub(samples[i + 1], samples[i]);
    const c1 = dot(v1, v1);
    let uNext: Vec3;
    if (c1 < EPS) {
      uNext = u;
    } else {
      const rL = sub(u, scale(v1, (2 / c1) * dot(v1, u)));
      const tL = sub(tangents[i], scale(v1, (2 / c1) * dot(v1, tangents[i])));
      const v2 = sub(tangents[i + 1], tL);
      const c2 = dot(v2, v2);
      uNext = c2 < EPS ? rL : sub(rL, scale(v2, (2 / c2) * dot(v2, rL)));
    }
    // Reortogonalizar contra la tangente real para matar deriva numérica.
    uNext = normalize(sub(uNext, scale(tangents[i + 1], dot(uNext, tangents[i + 1]))));
    if (length(uNext) < 0.5) {
      uNext = anyPerpendicular(tangents[i + 1]);
    }
    u = uNext;
    frames.push({ t: tangents[i + 1], u, v: cross(tangents[i + 1], u) });
  }
  return frames;
}

/** Gira el plano transversal (u, v) alrededor de la tangente. */
export function rotateFrames(frames: Frame[], angleDeg: number): Frame[] {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return frames.map(({ t, u, v }) => ({
    t,
    u: add(scale(u, c), scale(v, s)),
    v: add(scale(u, -s), scale(v, c)),
  }));
}

/**
 * Quaternion (x, y, z, w) que lleva los ejes locales del mapper
 * (tangentDirection = X, bitangentDirection = Y, normalDirection = Z) a (u, v, t).
 * Es la matriz de rotación con columnas u, v, t.
 */
export function frameToQuaternion(frame: Frame): [number, number, number, number] {
  const { u, v, t } = frame;
  // m[fila][col]; columnas = u, v, t
  const m00 = u[0];
  const m10 = u[1];
  const m20 = u[2];
  const m01 = v[0];
  const m11 = v[1];
  const m21 = v[2];
  const m02 = t[0];
  const m12 = t[1];
  const m22 = t[2];
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** Aplica un quaternion a un vector (para pruebas y para el modo stretched). */
export function rotateVecByQuat(v: Vec3, q: [number, number, number, number]): Vec3 {
  const [qx, qy, qz, qw] = q;
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const qv: Vec3 = [qx, qy, qz];
  const c1 = cross(qv, v);
  const c2 = cross(qv, c1);
  return add(v, add(scale(c1, 2 * qw), scale(c2, 2)));
}

export interface CenterlineBuild extends OrientedCenterline {
  samples: Vec3[];
  frames: Frame[];
  lengthMm: number;
}

/**
 * De los puntos de control a lo que consume el mapper: muestras a paso
 * uniforme y un quaternion por muestra, con el plano transversal girado θ.
 * Devuelve null si no hay al menos dos puntos distintos.
 */
export function buildOrientedCenterline(
  controlPoints: Vec3[],
  stepMm: number,
  angleDeg: number
): CenterlineBuild | null {
  const samples = resampleCatmullRom(controlPoints, stepMm);
  if (samples.length < 2 || arcLength(samples) < stepMm) {
    return null;
  }
  const frames = rotateFrames(rotationMinimizingFrames(samples), angleDeg);
  const points = new Float32Array(samples.length * 3);
  const orientations = new Float32Array(samples.length * 4);
  samples.forEach((p, i) => {
    points.set(p, i * 3);
    orientations.set(frameToQuaternion(frames[i]), i * 4);
  });
  return { points, orientations, samples, frames, lengthMm: arcLength(samples) };
}
