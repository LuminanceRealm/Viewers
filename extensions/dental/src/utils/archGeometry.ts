import type { Vec3 } from '../constants';

/**
 * Geometría del arco dental. Todo se trabaja en **coordenadas de rejilla en
 * mm**: a = a lo largo de las filas (rowCos), b = a lo largo de las columnas
 * (colCos), c = a lo largo de la normal de los cortes. El arco es una curva en
 * el plano (a, b); la panorámica y los cortes transversales son superficies
 * paralelas a la normal, así que c nunca interviene en el trazado.
 *
 * Coordenadas de arco de un punto: s = mm a lo largo del arco, o = mm hacia
 * vestibular (afuera del arco) y c = mm a lo largo de la normal.
 */
export interface GridAxes {
  origin: Vec3;
  rowCos: Vec3;
  colCos: Vec3;
  normal: Vec3;
}

export interface Arch {
  count: number;
  stepMm: number;
  lengthMm: number;
  /** Posición (a, b) de cada muestra. */
  a: Float64Array;
  b: Float64Array;
  /** Tangente unitaria (hacia s creciente). */
  ta: Float64Array;
  tb: Float64Array;
  /** Normal unitaria en el plano, hacia vestibular. */
  na: Float64Array;
  nb: Float64Array;
  /** El arco se recorre al revés de como se trazó, para empezar en la derecha del paciente. */
  reversed: boolean;
}

export interface ArchCoords {
  s: number;
  o: number;
  c: number;
}

const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

export function worldToGrid(axes: GridAxes, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - axes.origin[0], p[1] - axes.origin[1], p[2] - axes.origin[2]];
  return [dot(d, axes.rowCos), dot(d, axes.colCos), dot(d, axes.normal)];
}

export function gridToWorld(axes: GridAxes, g: Vec3): Vec3 {
  const { origin, rowCos, colCos, normal } = axes;
  return [
    origin[0] + g[0] * rowCos[0] + g[1] * colCos[0] + g[2] * normal[0],
    origin[1] + g[0] * rowCos[1] + g[1] * colCos[1] + g[2] * normal[1],
    origin[2] + g[0] * rowCos[2] + g[1] * colCos[2] + g[2] * normal[2],
  ];
}

type P = number[];

const dist = (p: P, q: P) => {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    sum += (p[i] - q[i]) * (p[i] - q[i]);
  }
  return Math.sqrt(sum);
};

const mix = (p: P, q: P, w: number): P => p.map((v, i) => v * (1 - w) + q[i] * w);

/** Catmull-Rom centrípeta entre p1 y p2 (sin incluir p2). */
function catmullRomSegment(p0: P, p1: P, p2: P, p3: P, samples: number): P[] {
  const dt = (p: P, q: P) => Math.max(Math.sqrt(dist(p, q)), 1e-4);
  const t0 = 0;
  const t1 = t0 + dt(p0, p1);
  const t2 = t1 + dt(p1, p2);
  const t3 = t2 + dt(p2, p3);
  const lerp = (p: P, q: P, tp: number, tq: number, t: number) =>
    Math.abs(tq - tp) < 1e-9 ? p : mix(p, q, (t - tp) / (tq - tp));

  const out: P[] = [];
  for (let n = 0; n < samples; n++) {
    const t = t1 + ((t2 - t1) * n) / samples;
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
 * Spline por los puntos de control, remuestreada a paso **exactamente**
 * uniforme en longitud de arco: la muestra i está a i × stepMm del inicio. El
 * resto que no completa un paso se descarta (menos de un paso).
 */
export function resampleSpline(points: P[], stepMm: number): P[] {
  const clean = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 1e-6);
  if (clean.length < 2) {
    return clean.map(p => [...p]);
  }
  const step = Math.max(stepMm, 1e-3);
  const n = clean.length;
  const dense: P[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = clean[i];
    const p2 = clean[i + 1];
    const samples = Math.max(4, Math.ceil((dist(p1, p2) / step) * 6));
    dense.push(
      ...catmullRomSegment(
        clean[Math.max(0, i - 1)],
        p1,
        p2,
        clean[Math.min(n - 1, i + 2)],
        samples
      )
    );
  }
  dense.push([...clean[n - 1]]);

  const out: P[] = [dense[0]];
  let carried = 0;
  for (let i = 1; i < dense.length; i++) {
    let from = dense[i - 1];
    const to = dense[i];
    let segLen = dist(from, to);
    while (segLen > 0 && carried + segLen >= step) {
      const need = step - carried;
      const p = mix(from, to, need / segLen);
      out.push(p);
      from = p;
      segLen -= need;
      carried = 0;
    }
    carried += segLen;
  }
  return out;
}

/**
 * Arma el arco a partir de los puntos de control en coordenadas mundo.
 * Devuelve null si no hay curva utilizable.
 *
 * - Siempre empieza en la **derecha del paciente** (x menor en LPS), sin
 *   importar en qué sentido se hicieron los clics: la panorámica sale con la
 *   convención radiográfica (derecha del paciente a la izquierda de la imagen).
 * - La normal apunta hacia **afuera** del arco (vestibular): es el lado
 *   opuesto al centroide de la curva.
 */
export function buildArch(controlWorld: Vec3[], axes: GridAxes, stepMm: number): Arch | null {
  if (controlWorld.length < 2) {
    return null;
  }
  let pts = resampleSpline(
    controlWorld.map(p => {
      const g = worldToGrid(axes, p);
      return [g[0], g[1]];
    }),
    stepMm
  );
  if (pts.length < 3) {
    return null;
  }

  const patientX = (p: P) => gridToWorld(axes, [p[0], p[1], 0])[0];
  const reversed = patientX(pts[0]) > patientX(pts[pts.length - 1]);
  if (reversed) {
    // Se remuestrea desde el otro extremo para que la muestra 0 caiga justo en
    // el primer punto de la derecha y el paso siga siendo uniforme.
    pts = resampleSpline(
      [...controlWorld].reverse().map(p => {
        const g = worldToGrid(axes, p);
        return [g[0], g[1]];
      }),
      stepMm
    );
  }

  const count = pts.length;
  const a = new Float64Array(count);
  const b = new Float64Array(count);
  const ta = new Float64Array(count);
  const tb = new Float64Array(count);
  const na = new Float64Array(count);
  const nb = new Float64Array(count);
  let ca = 0;
  let cb = 0;
  for (let i = 0; i < count; i++) {
    a[i] = pts[i][0];
    b[i] = pts[i][1];
    ca += a[i];
    cb += b[i];
  }
  ca /= count;
  cb /= count;

  let outward = 0;
  for (let i = 0; i < count; i++) {
    const prev = Math.max(0, i - 1);
    const next = Math.min(count - 1, i + 1);
    let da = a[next] - a[prev];
    let db = b[next] - b[prev];
    const len = Math.hypot(da, db) || 1;
    da /= len;
    db /= len;
    ta[i] = da;
    tb[i] = db;
    na[i] = db;
    nb[i] = -da;
    outward += na[i] * (a[i] - ca) + nb[i] * (b[i] - cb);
  }
  if (outward < 0) {
    for (let i = 0; i < count; i++) {
      na[i] = -na[i];
      nb[i] = -nb[i];
    }
  }

  return { count, stepMm, lengthMm: (count - 1) * stepMm, a, b, ta, tb, na, nb, reversed };
}

export function clampS(arch: Arch, s: number): number {
  return Math.min(arch.lengthMm, Math.max(0, s));
}

interface ArchPoint {
  a: number;
  b: number;
  ta: number;
  tb: number;
  na: number;
  nb: number;
}

/** Posición, tangente y normal del arco a s mm del inicio (interpolación lineal). */
export function archPointAt(arch: Arch, s: number): ArchPoint {
  const f = clampS(arch, s) / arch.stepMm;
  const i = Math.min(arch.count - 2, Math.floor(f));
  const w = f - i;
  const lerp = (v: Float64Array) => v[i] * (1 - w) + v[i + 1] * w;
  const unit = (x: number, y: number) => {
    const len = Math.hypot(x, y) || 1;
    return [x / len, y / len];
  };
  const [tx, ty] = unit(lerp(arch.ta), lerp(arch.tb));
  const [nx, ny] = unit(lerp(arch.na), lerp(arch.nb));
  return { a: lerp(arch.a), b: lerp(arch.b), ta: tx, tb: ty, na: nx, nb: ny };
}

export function archToGrid(arch: Arch, coords: ArchCoords): Vec3 {
  const p = archPointAt(arch, coords.s);
  return [p.a + coords.o * p.na, p.b + coords.o * p.nb, coords.c];
}

/**
 * Coordenadas de arco de un punto de rejilla: la muestra más cercana en el
 * plano y, sobre ella, el avance por la tangente y el desvío por la normal.
 */
export function gridToArch(arch: Arch, g: Vec3): ArchCoords {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < arch.count; i++) {
    const d = (g[0] - arch.a[i]) ** 2 + (g[1] - arch.b[i]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const da = g[0] - arch.a[best];
  const db = g[1] - arch.b[best];
  const along = da * arch.ta[best] + db * arch.tb[best];
  const s = clampS(arch, best * arch.stepMm + along);
  // El desvío se mide contra la normal en ese s, no la de la muestra, para que
  // ida y vuelta (archToGrid ∘ gridToArch) coincidan.
  const p = archPointAt(arch, s);
  return { s, o: (g[0] - p.a) * p.na + (g[1] - p.b) * p.nb, c: g[2] };
}

export function worldToArch(arch: Arch, axes: GridAxes, world: Vec3): ArchCoords {
  return gridToArch(arch, worldToGrid(axes, world));
}

export function archToWorld(arch: Arch, axes: GridAxes, coords: ArchCoords): Vec3 {
  return gridToWorld(axes, archToGrid(arch, coords));
}

/**
 * Trayecto del canal en coordenadas de arco: los puntos marcados, ordenados a
 * lo largo del arco y unidos con una spline.
 */
export function nervePath(arch: Arch, axes: GridAxes, pointsWorld: Vec3[]): ArchCoords[] {
  const sorted = pointsWorld.map(p => worldToArch(arch, axes, p)).sort((p, q) => p.s - q.s);
  if (sorted.length < 2) {
    return sorted;
  }
  return resampleSpline(
    sorted.map(p => [p.s, p.o, p.c]),
    0.5
  ).map(([s, o, c]) => ({ s, o, c }));
}

/** Dónde cruza el trayecto del canal el corte en s; null si no llega hasta ahí. */
export function nerveAtS(path: ArchCoords[], s: number): { o: number; c: number } | null {
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const q = path[i];
    if ((p.s <= s && s <= q.s) || (q.s <= s && s <= p.s)) {
      const span = q.s - p.s;
      const w = Math.abs(span) < 1e-9 ? 0 : (s - p.s) / span;
      return { o: p.o + (q.o - p.o) * w, c: p.c + (q.c - p.c) * w };
    }
  }
  return null;
}

export type RulerView = 'pano' | 'cross';

/**
 * Longitud de una regla en mm.
 * - En un corte transversal el plano es recto: distancia real en 3D.
 * - En la panorámica se mide **sobre la superficie curva** (avance por el arco
 *   y altura), que es lo que se ve en la imagen; la cuerda en 3D sería más
 *   corta en tramos largos.
 */
export function rulerLengthMm(view: RulerView, p: ArchCoords, q: ArchCoords, pw: Vec3, qw: Vec3) {
  if (view === 'pano') {
    return Math.hypot(q.s - p.s, q.c - p.c);
  }
  return Math.hypot(qw[0] - pw[0], qw[1] - pw[1], qw[2] - pw[2]);
}
