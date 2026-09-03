export const TOOL_NAME = 'BreastKinetics';

export type Vec3 = [number, number, number];

/**
 * Paleta categórica de ROIs, en orden fijo (nunca se recicla: la quinta ROI
 * reutiliza la primera con un índice visible). Azul, ámbar, verde, rosa: pares
 * adyacentes distinguibles bajo deuteranopía sobre fondo negro.
 */
export const ROI_COLORS = ['#4fa3ff', '#ffb547', '#7fd67f', '#f06292'];

export function roiColor(index: number): string {
  return ROI_COLORS[index % ROI_COLORS.length];
}

export const DEFAULT_RADIUS_MM = 3;
export const MIN_RADIUS_MM = 1;
export const MAX_RADIUS_MM = 15;

/** Umbrales BI-RADS (ACR MRI lexicon) para clasificar la curva. */
export const DELAYED_THRESHOLD_PCT = 10;
export const INITIAL_SLOW_MAX_PCT = 50;
export const INITIAL_MEDIUM_MAX_PCT = 100;

/** Desplazamiento entre fases a partir del cual se avisa de movimiento. */
export const MOTION_WARN_MM = 3;

/** Series derivadas que no son fases de adquisición (sustracciones, MIP, reformateos). */
export const DERIVED_DESCRIPTION_REGEX = /\b(SUB\w*|MIP|PROJ\w*|MPR|REFORMAT\w*|COLOR|MAP)\b/i;

/** Tolerancias para considerar idéntica la geometría de dos series. */
export const GEOMETRY_POSITION_TOL_MM = 0.5;
export const GEOMETRY_ORIENTATION_TOL = 1e-3;
export const GEOMETRY_SPACING_TOL_MM = 1e-3;

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
