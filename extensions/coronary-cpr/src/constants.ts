export const TOOL_NAME = 'CoronaryCPR';

export type Vec3 = [number, number, number];

export interface ArteryDefinition {
  id: number;
  short: string;
  label: string;
  /** rgba 0–255 */
  color: [number, number, number, number];
}

/** Mismas siglas y colores que el score de calcio, para que el usuario no reaprenda. */
export const ARTERIES: ArteryDefinition[] = [
  { id: 1, short: 'TCI', label: 'Tronco coronario izquierdo', color: [255, 99, 71, 255] },
  { id: 2, short: 'DA', label: 'Descendente anterior', color: [66, 165, 245, 255] },
  { id: 3, short: 'Cx', label: 'Circunfleja', color: [102, 187, 106, 255] },
  { id: 4, short: 'CD', label: 'Coronaria derecha', color: [255, 167, 38, 255] },
];

export function arteryById(id: number): ArteryDefinition | undefined {
  return ARTERIES.find(a => a.id === id);
}

export function arteryCss([r, g, b, a]: number[]): string {
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
}

/** Paso de remuestreo de la centerline en mm. */
export const RESAMPLE_STEP_MM = 0.5;

/** Ancho del plano curvo (perpendicular al vaso), en mm. */
export const DEFAULT_WIDTH_MM = 40;
export const MIN_WIDTH_MM = 20;
export const MAX_WIDTH_MM = 60;

/** Margen del recorte del volumen alrededor del trazado, además del medio ancho. */
export const CROP_MARGIN_MM = 10;

/** Imán al lumen: radio de búsqueda en el plano y rango de HU del contraste. */
export const SNAP_RADIUS_MM = 2.5;
export const LUMEN_HU_MIN = 150;
export const LUMEN_HU_MAX = 650;

/** Ventana por defecto para angio-CT coronaria. */
export const DEFAULT_WINDOW = 800;
export const DEFAULT_LEVEL = 300;

export const WL_PRESETS = [
  { label: 'Angio', window: 800, level: 300 },
  { label: 'Calcio', window: 1500, level: 400 },
  { label: 'Blando', window: 400, level: 40 },
];

/** Grados por paso de rueda en la vista CPR. */
export const ROTATION_STEP_DEG = 5;

/** Un punto se considera "en el corte" si dista menos de esto del plano del viewport. */
export const IN_PLANE_TOLERANCE_MM = 1.0;

/**
 * Mientras las herramientas no estén validadas contra una estación de trabajo,
 * se muestran como beta en el botón, el panel y los archivos exportados.
 * Quitar el "beta" = poner esto en false y regenerar el manual.
 */
export const IS_BETA = true;
export const BETA_NOTICE = IS_BETA
  ? 'Herramienta en evaluación (beta): sus resultados son de apoyo y no sustituyen a la estación de trabajo.'
  : '';
