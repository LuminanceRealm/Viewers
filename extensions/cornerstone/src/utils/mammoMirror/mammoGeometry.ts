/**
 * NUBIX: geometría de la lectura en espejo de mamografía 2D. Funciones puras,
 * sin cornerstone, para poder probarlas con jest (`mammoGeometry.test.js`).
 *
 * Coordenadas "anatómicas" de una proyección, en mm:
 *  - u: distancia a la pared torácica (borde de la imagen donde está el pectoral).
 *  - v: distancia vertical al centro de la imagen, positiva hacia abajo en pantalla.
 * El mismo (u, v) en la mama derecha y en la izquierda es el punto simétrico, así
 * que el espejo se reduce a traducir por (u, v) entre las dos imágenes.
 */

export type MammoLaterality = 'R' | 'L';
export type MammoViewName = 'CC' | 'MLO';
export type MammoView = {
  laterality: MammoLaterality;
  view: MammoViewName;
  /** RCC, LCC, RMLO o LMLO */
  code: string;
};

/**
 * Por encima de una imagen por serie no se considera mamografía 2D: así queda
 * fuera la tomosíntesis, venga como un multiframe (NumberOfFrames) o como una
 * instancia por corte, y también una serie con varias proyecciones juntas.
 */
export const MAX_MAMMO_IMAGES = 1;

const CC_CODES = ['R-10242', '399162004'];
const MLO_CODES = ['R-10226', '399368009'];

/** PatientOrientation llega como arreglo del manifiesto o como cadena `P\\FL`. */
export function parsePatientOrientation(value: unknown): [string, string] | undefined {
  let parts: unknown[];
  if (Array.isArray(value)) {
    parts = value;
  } else if (typeof value === 'string') {
    parts = value.split('\\');
  } else {
    return;
  }
  if (parts.length < 2) {
    return;
  }
  const [row, column] = parts.map(p =>
    String(p ?? '')
      .trim()
      .toUpperCase()
  );
  if (!row || !column) {
    return;
  }
  return [row, column];
}

function readLaterality(instance): MammoLaterality | undefined {
  const frameLaterality =
    instance?.SharedFunctionalGroupsSequence?.[0]?.FrameAnatomySequence?.[0]?.FrameLaterality;
  const value = String(instance?.ImageLaterality || instance?.Laterality || frameLaterality || '')
    .trim()
    .toUpperCase();
  return value === 'R' || value === 'L' ? value : undefined;
}

function readView(instance): MammoViewName | undefined {
  const viewPosition = String(instance?.ViewPosition || '')
    .trim()
    .toUpperCase();
  if (viewPosition === 'CC' || viewPosition === 'MLO') {
    return viewPosition;
  }
  if (viewPosition) {
    // ML, LM, XCCL, etc.: proyecciones adicionales que no entran al espejo.
    return;
  }

  const viewCode = instance?.ViewCodeSequence?.[0]?.CodeValue;
  if (CC_CODES.includes(viewCode)) {
    return 'CC';
  }
  if (MLO_CODES.includes(viewCode)) {
    return 'MLO';
  }
  if (viewCode) {
    return;
  }

  // Sin ViewPosition ni ViewCode (el manifiesto no los trae): la dirección de
  // las columnas lo dice. En la CC apunta a un lado (L/R); en la MLO apunta
  // hacia los pies o la cabeza y además a un lado (FL, FR, HL...). Una F o H
  // sola es una lateral pura (ML/LM) y se descarta.
  const orientation = parsePatientOrientation(instance?.PatientOrientation);
  if (!orientation) {
    return;
  }
  const column = orientation[1];
  const vertical = /[FH]/.test(column);
  const side = /[LR]/.test(column);
  if (vertical && side) {
    return 'MLO';
  }
  if (!vertical && side) {
    return 'CC';
  }
}

/**
 * Identifica una de las cuatro proyecciones estándar en un display set, o
 * devuelve undefined si no es mamografía 2D de una sola imagen.
 */
export function classifyMammoDisplaySet(displaySet): MammoView | undefined {
  if (!displaySet || displaySet.unsupported) {
    return;
  }
  const instance = displaySet.images?.[0] ?? displaySet.instances?.[0];
  const modality = displaySet.Modality ?? instance?.Modality;
  if (modality !== 'MG') {
    return;
  }
  const imageCount = displaySet.images?.length ?? displaySet.instances?.length ?? 0;
  const frameCount = displaySet.numImageFrames ?? Number(instance?.NumberOfFrames || 1);
  if (imageCount !== 1 || frameCount > MAX_MAMMO_IMAGES) {
    return;
  }
  const laterality = readLaterality(instance);
  const view = readView(instance);
  if (!laterality || !view) {
    return;
  }
  return { laterality, view, code: `${laterality}${view}` };
}

/** Lado de la imagen (en columnas) donde está la pared torácica. */
export function chestWallImageSide(patientOrientation): 'left' | 'right' | undefined {
  const orientation = parsePatientOrientation(patientOrientation);
  if (!orientation) {
    return;
  }
  // La primera componente es hacia dónde avanzan las columnas: si avanzan hacia
  // posterior, la pared torácica está a la derecha de la imagen.
  const row = orientation[0];
  if (row.startsWith('P')) {
    return 'right';
  }
  if (row.startsWith('A')) {
    return 'left';
  }
}

/**
 * Lado del viewport hacia el centro de la pantalla. Convención radiológica:
 * la mama derecha a la izquierda de la pantalla, así que su pared torácica va
 * a la derecha del viewport, y al revés para la izquierda.
 */
export function innerCanvasSide(laterality: MammoLaterality): 'left' | 'right' {
  return laterality === 'R' ? 'right' : 'left';
}

/**
 * Volteos necesarios para la presentación estándar: pared torácica hacia el
 * centro; MLO con la axila arriba; CC con el lado externo arriba.
 */
export function displayFlips(
  mammoView: MammoView,
  patientOrientation
): { flipHorizontal: boolean; flipVertical: boolean } | undefined {
  const orientation = parsePatientOrientation(patientOrientation);
  const chestWall = chestWallImageSide(patientOrientation);
  if (!orientation || !chestWall) {
    return;
  }
  const flipHorizontal = chestWall !== innerCanvasSide(mammoView.laterality);

  const column = orientation[1];
  let flipVertical = false;
  if (mammoView.view === 'MLO') {
    flipVertical = column.includes('H');
  } else {
    // En la CC las filas deben avanzar hacia medial (hacia la otra mama), es
    // decir L en la derecha y R en la izquierda.
    flipVertical = column.includes(mammoView.laterality);
  }
  return { flipHorizontal, flipVertical };
}

export type MammoImageFrame = {
  /** columnas y filas de la imagen */
  columns: number;
  rows: number;
  /** mm por píxel a lo largo de las columnas (x) y de las filas (y) */
  columnSpacing: number;
  rowSpacing: number;
  chestWall: 'left' | 'right';
  /** la cámara muestra la imagen volteada verticalmente */
  flipVertical: boolean;
};

/** Índice de imagen [columna, fila] → coordenadas anatómicas [u, v] en mm. */
export function imageToAnatomical(frame: MammoImageFrame, [column, row]: number[]): number[] {
  const u = (frame.chestWall === 'left' ? column : frame.columns - column) * frame.columnSpacing;
  const fromCenter = (row - frame.rows / 2) * frame.rowSpacing;
  return [u, frame.flipVertical ? -fromCenter : fromCenter];
}

/** Coordenadas anatómicas [u, v] en mm → índice de imagen [columna, fila]. */
export function anatomicalToImage(frame: MammoImageFrame, [u, v]: number[]): number[] {
  const columnsFromWall = u / frame.columnSpacing;
  const column = frame.chestWall === 'left' ? columnsFromWall : frame.columns - columnsFromWall;
  const fromCenter = (frame.flipVertical ? -v : v) / frame.rowSpacing;
  return [column, frame.rows / 2 + fromCenter];
}

/** El punto simétrico de una imagen en la otra. */
export function mirrorImagePoint(
  source: MammoImageFrame,
  target: MammoImageFrame,
  point: number[]
): number[] {
  return anatomicalToImage(target, imageToAnatomical(source, point));
}

export type MammoTissueBounds = {
  /** columnas desde la pared torácica hasta el punto más lejano con tejido */
  fromWall: number;
  /** primera y última fila con tejido junto a la pared */
  top: number;
  bottom: number;
};

/**
 * Dónde está la mama dentro de la imagen, para encuadrarla en vez de mostrar
 * la imagen completa (el fondo es la mayor parte y al acercar se caía en él).
 *
 * - Fondo: mediana de la franja más alejada de la pared. Tejido: lo que se
 *   aparta del fondo más de un 10 % del rango de la imagen.
 * - Alcance horizontal: desde la pared hacia fuera, la última columna con algo
 *   de tejido, cortando en un hueco de más del 5 % del ancho; así no cuentan
 *   las etiquetas sueltas ("R CC") que el equipo graba en el fondo.
 * - Alcance vertical: filas con tejido en una franja pegada a la pared, donde
 *   la mama (y el pectoral en la MLO) es más alta; tampoco ve las etiquetas.
 *
 * Devuelve undefined si no encuentra una mama razonable; quien llama encuadra
 * entonces la imagen completa, como antes.
 */
export function findTissueBounds(
  pixels: ArrayLike<number>,
  columns: number,
  rows: number,
  chestWall: 'left' | 'right'
): MammoTissueBounds | undefined {
  if (!pixels || columns < 16 || rows < 16 || pixels.length < columns * rows) {
    return;
  }
  const step = Math.max(1, Math.round(Math.sqrt((columns * rows) / 250000)));
  const fromWallToColumn = (d: number) => (chestWall === 'left' ? d : columns - 1 - d);

  let min = Infinity;
  let max = -Infinity;
  const outer: number[] = [];
  const outerStart = Math.floor(columns * 0.97);
  for (let r = 0; r < rows; r += step) {
    for (let d = 0; d < columns; d += step) {
      const value = pixels[r * columns + fromWallToColumn(d)];
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
      if (d >= outerStart) {
        outer.push(value);
      }
    }
  }
  if (!outer.length || max <= min) {
    return;
  }
  outer.sort((a, b) => a - b);
  const background = outer[Math.floor(outer.length / 2)];
  const threshold = (max - min) * 0.1;
  const isTissue = (r: number, d: number) =>
    Math.abs(pixels[r * columns + fromWallToColumn(d)] - background) > threshold;

  const sampledRows = Math.ceil(rows / step);
  const maxGap = columns * 0.05;
  let fromWall = -1;
  for (let d = 0; d < columns; d += step) {
    let count = 0;
    for (let r = 0; r < rows; r += step) {
      if (isTissue(r, d)) {
        count++;
      }
    }
    if (count / sampledRows > 0.03) {
      fromWall = d;
    } else if (fromWall >= 0 && d - fromWall > maxGap) {
      break;
    }
  }

  const stripStart = Math.floor(columns * 0.01);
  const stripEnd = Math.max(stripStart + step, Math.floor(columns * 0.08));
  const stripSamples = Math.ceil((stripEnd - stripStart) / step);
  let top = -1;
  let bottom = -1;
  for (let r = 0; r < rows; r += step) {
    let count = 0;
    for (let d = stripStart; d < stripEnd; d += step) {
      if (isTissue(r, d)) {
        count++;
      }
    }
    if (count / stripSamples > 0.3) {
      if (top < 0) {
        top = r;
      }
      bottom = r;
    }
  }

  if (fromWall < columns * 0.1 || top < 0 || bottom - top < rows * 0.1) {
    return;
  }
  return {
    fromWall: Math.min(columns, fromWall + step),
    top,
    bottom: Math.min(rows, bottom + step),
  };
}

export type MammoFraming = {
  /** mm desde la pared hasta el punto más lejano a mostrar */
  uMax: number;
  /** mm desde el centro vertical, arriba y abajo en pantalla */
  vMin: number;
  vMax: number;
};

/** Marco anatómico (con margen) de una mama a partir de sus límites en la imagen. */
export function framingFromBounds(
  frame: MammoImageFrame,
  bounds: MammoTissueBounds | undefined
): MammoFraming {
  const b = bounds ?? { fromWall: frame.columns, top: 0, bottom: frame.rows };
  const [, vTop] = imageToAnatomical(frame, [0, b.top]);
  const [, vBottom] = imageToAnatomical(frame, [0, b.bottom]);
  const uMax = b.fromWall * frame.columnSpacing;
  const vMin = Math.min(vTop, vBottom);
  const vMax = Math.max(vTop, vBottom);
  const marginV = (vMax - vMin) * 0.04;
  return { uMax: uMax * 1.06, vMin: vMin - marginV, vMax: vMax + marginV };
}

/** El marco que abarca las dos mamas, para que el par se vea con la misma escala. */
export function unionFraming(a: MammoFraming, b?: MammoFraming): MammoFraming {
  if (!b) {
    return a;
  }
  return {
    uMax: Math.max(a.uMax, b.uMax),
    vMin: Math.min(a.vMin, b.vMin),
    vMax: Math.max(a.vMax, b.vMax),
  };
}

/**
 * Cámara que muestra el marco con la pared pegada al borde interior: mitad de
 * altura visible (parallelScale, mm) y centro de la vista en coordenadas
 * anatómicas.
 */
export function cameraForFraming(
  framing: MammoFraming,
  canvasWidth: number,
  canvasHeight: number
): { parallelScale: number; center: number[] } {
  const aspect = canvasWidth / Math.max(1, canvasHeight);
  const parallelScale = Math.max((framing.vMax - framing.vMin) / 2, framing.uMax / 2 / aspect);
  // La vista mide 2·ps·aspect mm de ancho; su centro queda a la mitad desde la pared.
  return {
    parallelScale,
    center: [parallelScale * aspect, (framing.vMin + framing.vMax) / 2],
  };
}
