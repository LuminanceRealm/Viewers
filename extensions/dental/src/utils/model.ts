import { MIN_ARCH_LENGTH_MM, NerveId, NERVES, Vec3 } from '../constants';
import type { DentalRuler, PendingRulerPoint, SeriesDentalState } from '../store/useDentalStore';
import {
  Arch,
  ArchCoords,
  RulerView,
  buildArch,
  clampS,
  nervePath,
  rulerLengthMm,
  worldToArch,
} from './archGeometry';
import { Projection, Raster, panoRays, sampleColumns, sectionRays } from './reslice';
import type { VolumeGrid } from './volumeGrid';

/** Paso del arco = píxel horizontal de la panorámica y de los cortes. */
export function archStepMm(grid: VolumeGrid): number {
  return Math.min(0.5, Math.max(0.15, Math.min(grid.spacing[0], grid.spacing[1])));
}

/** Arco utilizable, o null si aún no hay curva suficiente. */
export function buildSeriesArch(grid: VolumeGrid, control: Vec3[]): Arch | null {
  const arch = buildArch(control, grid, archStepMm(grid));
  return arch && arch.lengthMm >= MIN_ARCH_LENGTH_MM ? arch : null;
}

export function buildPano(
  grid: VolumeGrid,
  arch: Arch,
  slabMm: number,
  projection: Projection
): Raster {
  return sampleColumns(grid, panoRays(arch, slabMm), projection);
}

export function resolveCursor(arch: Arch, cursorS: number | null): number {
  return clampS(arch, cursorS ?? arch.lengthMm / 2);
}

export interface Section {
  /** Posición sobre el arco; null si el corte cae fuera del arco. */
  s: number | null;
  /** Número del corte: su posición entre la separación. */
  number: number;
  raster: Raster | null;
}

/** `count` cortes centrados en el cursor, a `spacingMm` uno de otro. */
export function buildSections(
  grid: VolumeGrid,
  arch: Arch,
  cursorS: number,
  spacingMm: number,
  widthMm: number,
  count: number
): Section[] {
  const half = Math.floor(count / 2);
  const sections: Section[] = [];
  for (let m = -half; m < count - half; m++) {
    const s = cursorS + m * spacingMm;
    const number = Math.round(s / spacingMm);
    if (s < -1e-6 || s > arch.lengthMm + 1e-6) {
      sections.push({ s: null, number, raster: null });
      continue;
    }
    sections.push({
      s,
      number,
      raster: sampleColumns(grid, sectionRays(arch, s, widthMm, arch.stepMm), 'avg'),
    });
  }
  return sections;
}

export interface RulerOverlay {
  id: number;
  view: RulerView;
  p: ArchCoords;
  q: ArchCoords;
  lengthMm: number;
  sectionS: number | null;
}

export interface Overlays {
  nervePaths: Record<NerveId, ArchCoords[]>;
  /** Puntos marcados del canal, en el mismo orden que en el store. */
  nervePoints: Record<NerveId, ArchCoords[]>;
  rulers: RulerOverlay[];
  pending: { view: RulerView; p: ArchCoords; sectionS: number | null } | null;
}

export function rulerOverlay(grid: VolumeGrid, arch: Arch, ruler: DentalRuler): RulerOverlay {
  const p = worldToArch(arch, grid, ruler.points[0]);
  const q = worldToArch(arch, grid, ruler.points[1]);
  return {
    id: ruler.id,
    view: ruler.view,
    p,
    q,
    lengthMm: rulerLengthMm(ruler.view, p, q, ruler.points[0], ruler.points[1]),
    sectionS: ruler.sectionS,
  };
}

export function buildOverlays(
  grid: VolumeGrid,
  arch: Arch,
  nerves: SeriesDentalState['nerves'],
  rulers: DentalRuler[],
  pending: PendingRulerPoint | null
): Overlays {
  const nervePaths = {} as Overlays['nervePaths'];
  const nervePoints = {} as Overlays['nervePoints'];
  NERVES.forEach(({ id }) => {
    nervePaths[id] = nervePath(arch, grid, nerves[id]);
    nervePoints[id] = nerves[id].map(p => worldToArch(arch, grid, p));
  });
  return {
    nervePaths,
    nervePoints,
    rulers: rulers.map(r => rulerOverlay(grid, arch, r)),
    pending: pending
      ? {
          view: pending.view,
          p: worldToArch(arch, grid, pending.point),
          sectionS: pending.sectionS,
        }
      : null,
  };
}

/** Altura del volumen en mm (lo que mide en vertical la panorámica). */
export function volumeHeightMm(grid: VolumeGrid): number {
  return grid.dims[2] * grid.spacing[2];
}

/**
 * Vertical de las vistas: mm desde el borde superior ↔ c (mm a lo largo de la
 * normal). El centro del píxel de la fila r está a (r + 0.5) × separación.
 */
export function cToViewY(grid: VolumeGrid, c: number): number {
  const [, , nz] = grid.dims;
  const sz = grid.spacing[2];
  const row = grid.upSign > 0 ? nz - 1 - c / sz : c / sz;
  return (row + 0.5) * sz;
}

export function viewYToC(grid: VolumeGrid, y: number): number {
  const [, , nz] = grid.dims;
  const sz = grid.spacing[2];
  const row = Math.min(nz - 1, Math.max(0, y / sz - 0.5));
  return grid.upSign > 0 ? (nz - 1 - row) * sz : row * sz;
}

/** Horizontal de la panorámica: mm desde el borde izquierdo ↔ s. */
export const sToPanoX = (arch: Arch, s: number) => s + arch.stepMm / 2;
export const panoXToS = (arch: Arch, x: number) => clampS(arch, x - arch.stepMm / 2);

/** Horizontal de un corte: vestibular (o > 0) a la izquierda. */
export const oToSectionX = (widthMm: number, pixelMm: number, o: number) =>
  widthMm / 2 - o + pixelMm / 2;
export const sectionXToO = (widthMm: number, pixelMm: number, x: number) =>
  widthMm / 2 - (x - pixelMm / 2);
