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
