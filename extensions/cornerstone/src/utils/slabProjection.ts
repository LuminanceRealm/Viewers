import { CONSTANTS, Enums, VolumeViewport } from '@cornerstonejs/core';

/**
 * NUBIX: proyección de grosor (slab) en las vistas de volumen: MIP, MinIP y
 * promedio. Cornerstone ya sabe pintarlas; aquí sólo se decide sobre qué
 * actor y se avisa al overlay de esquina para que la etiqueta cambie al
 * momento.
 *
 * No hay estado propio: el modo y el grosor se leen del viewport, así que al
 * cambiar de protocolo (viewports nuevos) vuelve todo a corte fino.
 */

export type SlabMode = 'mip' | 'minip' | 'avg' | 'off';

export const SLAB_MODIFIED_EVENT = 'nubix-slab-modified';

/** Grosor con el que arranca una proyección si la vista está en corte fino. */
export const DEFAULT_SLAB_MM = 10;
export const MIN_SLAB_MM = 1;
export const MAX_SLAB_MM = 50;

const { MINIMUM_SLAB_THICKNESS } = CONSTANTS.RENDERING_DEFAULTS;

const BLEND_BY_MODE: Record<Exclude<SlabMode, 'off'>, Enums.BlendModes> = {
  mip: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
  minip: Enums.BlendModes.MINIMUM_INTENSITY_BLEND,
  avg: Enums.BlendModes.AVERAGE_INTENSITY_BLEND,
};

export const SLAB_LABELS: Record<SlabMode, string> = {
  mip: 'MIP',
  minip: 'MinIP',
  avg: 'Promedio',
  off: 'Corte fino',
};

/** Sólo las vistas de volumen ortográficas (MPR) acumulan grosor. */
export function isSlabCapable(viewport): viewport is VolumeViewport {
  return viewport instanceof VolumeViewport && viewport.type === Enums.ViewportType.ORTHOGRAPHIC;
}

/**
 * Actor de la imagen. Las segmentaciones y fusiones van en otros actores y
 * no deben proyectarse: una MIP del labelmap taparía la anatomía.
 */
function imageActorUIDs(viewport: VolumeViewport): string[] {
  const actor = viewport.getDefaultActor?.();
  return actor?.uid ? [actor.uid] : [];
}

export function getSlabState(viewport): { mode: SlabMode; thickness: number } {
  if (!isSlabCapable(viewport)) {
    return { mode: 'off', thickness: 0 };
  }
  const uids = imageActorUIDs(viewport);
  if (!uids.length) {
    return { mode: 'off', thickness: 0 };
  }
  const blend = viewport.getBlendMode(uids);
  const mode =
    (Object.keys(BLEND_BY_MODE) as Array<keyof typeof BLEND_BY_MODE>).find(
      key => BLEND_BY_MODE[key] === blend
    ) ?? 'off';
  return { mode, thickness: viewport.getSlabThickness() };
}

/**
 * Aplica el modo y el grosor. Sin grosor explícito conserva el actual si ya
 * hay proyección, o usa el de arranque si la vista estaba en corte fino.
 * Devuelve false si el viewport no admite proyección.
 */
export function applySlab(viewport, mode: SlabMode, thickness?: number): boolean {
  if (!isSlabCapable(viewport)) {
    return false;
  }
  const uids = imageActorUIDs(viewport);
  if (!uids.length) {
    return false;
  }

  if (mode === 'off') {
    viewport.setBlendMode(Enums.BlendModes.COMPOSITE, uids);
    viewport.setSlabThickness(MINIMUM_SLAB_THICKNESS, uids);
  } else {
    const current = getSlabState(viewport);
    const mm = clampThickness(
      thickness ?? (current.mode === 'off' ? DEFAULT_SLAB_MM : current.thickness)
    );
    viewport.setBlendMode(BLEND_BY_MODE[mode], uids);
    viewport.setSlabThickness(mm, uids);
  }

  viewport.render();
  viewport.element?.dispatchEvent(new CustomEvent(SLAB_MODIFIED_EVENT));
  return true;
}

export function clampThickness(mm: number): number {
  if (!Number.isFinite(mm)) {
    return DEFAULT_SLAB_MM;
  }
  return Math.min(MAX_SLAB_MM, Math.max(MIN_SLAB_MM, mm));
}

/** Texto para la esquina de la imagen, o null en corte fino. */
export function slabOverlayText(viewport): string | null {
  const { mode, thickness } = getSlabState(viewport);
  if (mode === 'off') {
    return null;
  }
  return `${SLAB_LABELS[mode]} ${Math.round(thickness)} mm`;
}
