/**
 * NUBIX: geometría de las mediciones ortopédicas (coxometría y gonometría).
 *
 * Funciones puras, sin dependencias de cornerstone, para poder probarlas con
 * jest. Los ángulos y distancias se calculan en coordenadas mundo (mm cuando
 * la imagen está calibrada); el lado del paciente y la dirección medial se
 * deciden en coordenadas de índice de imagen [columna, fila], que no cambian
 * al voltear o rotar el viewport.
 */

export type Point = ArrayLike<number>;

const RAD_TO_DEG = 180 / Math.PI;

function sub(a: Point, b: Point): number[] {
  return [a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)];
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + (a[2] ?? 0) * (b[2] ?? 0);
}

function norm(a: Point): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Point, b: Point): number {
  return norm(sub(a, b));
}

/** Ángulo entre dos vectores, en grados (0–180). */
export function angleBetweenVectors(u: Point, v: Point): number {
  const nu = norm(u);
  const nv = norm(v);
  if (!nu || !nv) {
    return NaN;
  }
  const cos = Math.min(1, Math.max(-1, dot(u, v) / (nu * nv)));
  return Math.acos(cos) * RAD_TO_DEG;
}

/** Ángulo en el vértice `vertex` formado por `a` y `b`, en grados. */
export function angleAtVertex(a: Point, vertex: Point, b: Point): number {
  return angleBetweenVectors(sub(a, vertex), sub(b, vertex));
}

/** Distancia del punto `p` a la recta que pasa por `a` y `b`. */
export function distanceToLine(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const len2 = dot(ab, ab);
  if (!len2) {
    return distance(p, a);
  }
  const t = dot(ap, ab) / len2;
  const foot = [a[0] + ab[0] * t, a[1] + ab[1] * t, (a[2] ?? 0) + ab[2] * t];
  return distance(p, foot);
}

export type PatientSide = 'R' | 'L';

/**
 * Dirección del paciente hacia la que crecen las columnas de la imagen, leída
 * de PatientOrientation (0020,0020). En una AP convencional vale "L": la
 * derecha del paciente queda a la izquierda de la imagen. Si falta, se asume
 * esa convención radiográfica.
 */
export function columnDirection(patientOrientation: unknown): PatientSide {
  let first: unknown = patientOrientation;
  if (Array.isArray(patientOrientation)) {
    first = patientOrientation[0];
  } else if (typeof patientOrientation === 'string') {
    first = patientOrientation.split('\\')[0];
  }
  if (typeof first === 'string') {
    // Puede venir compuesta ("LA", "LP"); manda la componente izquierda/derecha.
    if (first.includes('R')) {
      return 'R';
    }
    if (first.includes('L')) {
      return 'L';
    }
  }
  return 'L';
}

/** Lado del paciente de un punto respecto de otro, por su columna. */
function sideOfSmallerColumn(columnDir: PatientSide): PatientSide {
  // Si las columnas crecen hacia la izquierda del paciente, la columna menor es la derecha.
  return columnDir === 'L' ? 'R' : 'L';
}

export interface AcetabularIndexInput {
  /** Cartílago trirradiado (Y) de un lado y del otro: la línea de Hilgenreiner. */
  triradiateA: Point;
  triradiateB: Point;
  /** Bordes laterales del techo acetabular, en cualquier orden. */
  edge1: Point;
  edge2: Point;
  /** Los mismos cuatro puntos en índice de imagen [columna, fila]. */
  indexTriradiateA: Point;
  indexTriradiateB: Point;
  columnDir: PatientSide;
}

export interface AcetabularSide {
  side: PatientSide;
  angle: number;
  triradiate: Point;
  edge: Point;
}

export interface AcetabularIndexResult {
  right: AcetabularSide;
  left: AcetabularSide;
}

/**
 * Índice acetabular bilateral (Hilgenreiner): en cada lado, ángulo entre la
 * línea de Hilgenreiner, prolongada hacia fuera, y la línea que va del
 * cartílago trirradiado al borde lateral del techo acetabular.
 *
 * Cada borde se asigna al cartílago que le queda más cerca (la pareja de
 * menor suma de distancias), así el orden de los clics no importa.
 */
export function acetabularIndex(input: AcetabularIndexInput): AcetabularIndexResult {
  const { triradiateA: yA, triradiateB: yB, edge1, edge2 } = input;

  const straight = distance(edge1, yA) + distance(edge2, yB);
  const crossed = distance(edge1, yB) + distance(edge2, yA);
  const [edgeA, edgeB] = straight <= crossed ? [edge1, edge2] : [edge2, edge1];

  // Hacia fuera en A es alejarse de B, y viceversa.
  const angleA = angleBetweenVectors(sub(yA, yB), sub(edgeA, yA));
  const angleB = angleBetweenVectors(sub(yB, yA), sub(edgeB, yB));

  const smaller = sideOfSmallerColumn(input.columnDir);
  const aIsSmaller = input.indexTriradiateA[0] <= input.indexTriradiateB[0];
  const sideA: PatientSide = aIsSmaller ? smaller : smaller === 'R' ? 'L' : 'R';

  const a: AcetabularSide = { side: sideA, angle: angleA, triradiate: yA, edge: edgeA };
  const b: AcetabularSide = {
    side: sideA === 'R' ? 'L' : 'R',
    angle: angleB,
    triradiate: yB,
    edge: edgeB,
  };

  return sideA === 'R' ? { right: a, left: b } : { right: b, left: a };
}

export type Alignment = 'varus' | 'valgus' | 'neutral';

export interface MechanicalAxisInput {
  /** Centro de la cabeza femoral, centro de la rodilla y centro del tobillo (mundo). */
  hip: Point;
  knee: Point;
  ankle: Point;
  /** Los mismos puntos en índice de imagen [columna, fila]. */
  indexHip: Point;
  indexKnee: Point;
  indexAnkle: Point;
  /** Número de columnas de la imagen: su mitad se toma como línea media del paciente. */
  imageColumns: number;
  columnDir: PatientSide;
}

export interface MechanicalAxisResult {
  /** Ángulo cadera-rodilla-tobillo medido en la rodilla (180° = eje recto). */
  hka: number;
  /** 180 − HKA, siempre positivo. */
  deviation: number;
  /** null cuando el miembro está sobre la línea media y no se puede saber qué lado es medial. */
  alignment: Alignment | null;
  /** Desviación del eje mecánico: distancia de la rodilla a la línea cadera-tobillo (mundo). */
  mad: number;
  /** Lado del paciente del miembro, o null si no se puede determinar. */
  side: PatientSide | null;
}

/** Por debajo de este desvío la rodilla se da por alineada. */
export const NEUTRAL_TOLERANCE_DEG = 0.5;
/** Fracción del ancho alrededor del centro en la que no se decide el lado. */
const MIDLINE_BAND = 0.05;

/**
 * Eje mecánico femorotibial (HKA) en la telerradiografía de miembros inferiores.
 *
 * Varo o valgo se decide por la posición de la rodilla respecto de la línea
 * cadera-tobillo (línea de Mikulicz): hacia fuera de la línea media es varo,
 * hacia dentro es valgo. La línea media del paciente se toma como la mitad de
 * la imagen, que es lo correcto en la telerradiografía bilateral en carga; si
 * la cadera cae en la franja central (placa de un solo miembro centrada) no se
 * puede saber qué lado es medial y se devuelve `alignment: null`.
 */
export function mechanicalAxis(input: MechanicalAxisInput): MechanicalAxisResult {
  const { hip, knee, ankle, indexHip, indexKnee, indexAnkle, imageColumns } = input;

  const hka = angleAtVertex(hip, knee, ankle);
  const deviation = Math.abs(180 - hka);
  const mad = distanceToLine(knee, hip, ankle);

  const midColumn = imageColumns / 2;
  const fromMidline = indexHip[0] - midColumn;
  if (!imageColumns || Math.abs(fromMidline) < MIDLINE_BAND * imageColumns) {
    return { hka, deviation, alignment: null, mad, side: null };
  }

  const smaller = sideOfSmallerColumn(input.columnDir);
  const side: PatientSide = fromMidline < 0 ? smaller : smaller === 'R' ? 'L' : 'R';

  if (deviation < NEUTRAL_TOLERANCE_DEG) {
    return { hka, deviation, alignment: 'neutral', mad, side };
  }

  // Vector de la rodilla respecto de su pie sobre la recta cadera-tobillo, en índice.
  const axis = [indexAnkle[0] - indexHip[0], indexAnkle[1] - indexHip[1]];
  const rel = [indexKnee[0] - indexHip[0], indexKnee[1] - indexHip[1]];
  const len2 = axis[0] * axis[0] + axis[1] * axis[1];
  const t = len2 ? (rel[0] * axis[0] + rel[1] * axis[1]) / len2 : 0;
  const offsetColumn = rel[0] - axis[0] * t;

  // Medial es hacia la línea media: columnas crecientes si la cadera está a la izquierda.
  const medialSign = fromMidline < 0 ? 1 : -1;
  const kneeIsMedial = offsetColumn * medialSign > 0;

  return { hka, deviation, alignment: kneeIsMedial ? 'valgus' : 'varus', mad, side };
}
