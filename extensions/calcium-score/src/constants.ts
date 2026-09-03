/**
 * Parámetros del score de Agatston tal como los define el método original
 * (Agatston et al., JACC 1990) y como los aplican las estaciones comerciales.
 */

/** Umbral de calcificación en unidades Hounsfield, válido para adquisiciones a 120 kVp. */
export const HU_THRESHOLD = 130;

/** Área mínima de una lesión en un corte para que cuente (descarta ruido). */
export const MIN_LESION_AREA_MM2 = 1;

/** El score se definió para cortes de 3 mm; otros espesores se normalizan a este. */
export const REFERENCE_SLICE_MM = 3;

/** kVp con el que fue calibrado el umbral de 130 HU. */
export const REFERENCE_KVP = 120;

/** Nombre de la herramienta de clic; coincide con el id del botón de la barra. */
export const TOOL_NAME = 'CalciumScore';

/** Prefijo del id de segmentación: hay una por serie, así se puede reencontrar. */
export const SEGMENTATION_ID_PREFIX = 'calcium-score:';

export function segmentationIdForDisplaySet(displaySetInstanceUID: string): string {
  return `${SEGMENTATION_ID_PREFIX}${displaySetInstanceUID}`;
}

export function isCalciumSegmentationId(segmentationId: string | undefined): boolean {
  return !!segmentationId && segmentationId.startsWith(SEGMENTATION_ID_PREFIX);
}

/** Índice del segmento que guarda todo lo que pasa del umbral y aún no tiene arteria. */
export const CANDIDATE_INDEX = 5;

/** Amarillo pálido y translúcido: presente pero sin robar protagonismo a la imagen. */
export const CANDIDATE_COLOR: [number, number, number, number] = [255, 226, 120, 90];

export interface ArteryDefinition {
  segmentIndex: number;
  /** Abreviatura clínica en español. */
  short: string;
  label: string;
  color: [number, number, number, number];
}

export const ARTERIES: ArteryDefinition[] = [
  { segmentIndex: 1, short: 'TCI', label: 'Tronco coronario izquierdo', color: [255, 99, 71, 255] },
  { segmentIndex: 2, short: 'DA', label: 'Descendente anterior', color: [66, 165, 245, 255] },
  { segmentIndex: 3, short: 'Cx', label: 'Circunfleja', color: [102, 187, 106, 255] },
  { segmentIndex: 4, short: 'CD', label: 'Coronaria derecha', color: [255, 167, 38, 255] },
];

export const ARTERY_INDICES = ARTERIES.map(a => a.segmentIndex);

export function arteryByIndex(segmentIndex: number): ArteryDefinition | undefined {
  return ARTERIES.find(a => a.segmentIndex === segmentIndex);
}
