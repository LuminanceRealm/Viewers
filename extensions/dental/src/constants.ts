export const TOOL_NAME = 'DentalArch';

export type Vec3 = [number, number, number];

/** Grosor de la panorámica (perpendicular al arco, en el plano axial), en mm. */
export const DEFAULT_SLAB_MM = 10;
export const MAX_SLAB_MM = 30;

/** Separación entre rayos del grosor; más fino no aporta con vóxeles de CBCT. */
export const SLAB_RAY_SPACING_MM = 0.5;

/** Cortes transversales: ancho vestíbulo-lingual, separación y grosor. */
export const SECTION_WIDTHS_MM = [20, 30, 40];
export const DEFAULT_SECTION_WIDTH_MM = 30;
export const SECTION_SPACINGS_MM = [1, 2, 3, 5];
export const DEFAULT_SECTION_SPACING_MM = 2;
/** Cada corte promedia este grosor a lo largo del arco (el CBCT es ruidoso a un vóxel). */
export const SECTION_THICKNESS_MM = 1;
export const MAX_SECTIONS = 9;

/** Un punto pertenece a un corte si dista menos de esto a lo largo del arco. */
export const SAME_SECTION_TOLERANCE_MM = 0.25;

/** El arco necesita al menos esta longitud para reconstruir algo útil. */
export const MIN_ARCH_LENGTH_MM = 10;

export type NerveId = 'R' | 'L';

export interface NerveDefinition {
  id: NerveId;
  short: string;
  label: string;
  color: string;
}

export const NERVES: NerveDefinition[] = [
  { id: 'R', short: 'Der', label: 'Canal mandibular derecho', color: '#ff9f43' },
  { id: 'L', short: 'Izq', label: 'Canal mandibular izquierdo', color: '#5ad1e6' },
];

export function nerveById(id: NerveId): NerveDefinition {
  return NERVES.find(n => n.id === id) ?? NERVES[0];
}

/** Radio del anillo con que se marca el canal en los cortes, en mm. Es una marca, no una medida. */
export const NERVE_MARK_RADIUS_MM = 1.25;

export const ARCH_COLOR = '#7dd3fc';
export const RULER_COLOR = '#fde047';
export const CURSOR_COLOR = '#a7f3d0';

/**
 * Mientras la herramienta no esté validada contra una estación de trabajo se
 * muestra como beta en el botón, el panel y la hoja impresa.
 * Quitar el "beta" = poner esto en false, quitar el sufijo del botón y regenerar el manual.
 */
export const IS_BETA = true;
export const BETA_NOTICE = IS_BETA
  ? 'Herramienta en evaluación (beta): sus resultados son de apoyo y no sustituyen a la estación de trabajo.'
  : '';
