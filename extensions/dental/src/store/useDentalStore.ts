import { create } from 'zustand';

import {
  DEFAULT_SECTION_SPACING_MM,
  DEFAULT_SECTION_WIDTH_MM,
  DEFAULT_SLAB_MM,
  MAX_SLAB_MM,
  NerveId,
  SAME_SECTION_TOLERANCE_MM,
  Vec3,
} from '../constants';
import type { RulerView } from '../utils/archGeometry';
import type { Projection, WindowLevel } from '../utils/reslice';

/** Qué hace el clic sobre la panorámica y los cortes. */
export type DockTool = 'navigate' | 'ruler' | 'nerveR' | 'nerveL';

export interface DentalRuler {
  id: number;
  view: RulerView;
  /** Extremos en coordenadas mundo. */
  points: [Vec3, Vec3];
  /** En un corte transversal: posición del corte sobre el arco al medir. */
  sectionS: number | null;
}

export interface PendingRulerPoint {
  view: RulerView;
  point: Vec3;
  sectionS: number | null;
}

export interface SeriesDentalState {
  ready: boolean;
  /** 0–1 mientras se cargan los cortes; null si no está cargando. */
  loading: number | null;
  error: string | null;
  /** Puntos de control del arco, en coordenadas mundo y en el orden de los clics. */
  arch: Vec3[];
  nerves: Record<NerveId, Vec3[]>;
  /** Posición del corte central, en mm sobre el arco; null = al centro. */
  cursorS: number | null;
  slabMm: number;
  projection: Projection;
  sectionSpacingMm: number;
  sectionWidthMm: number;
  tool: DockTool;
  pending: PendingRulerPoint | null;
  rulers: DentalRuler[];
  nextRulerId: number;
  /** Ventana elegida por el usuario; null = automática. */
  panoWl: WindowLevel | null;
  crossWl: WindowLevel | null;
}

interface DentalStoreState {
  bySeries: Record<string, SeriesDentalState>;
  /** Serie que muestra la franja inferior. */
  activeUid: string | null;
  dockOpen: boolean;
  dockMaximized: boolean;
  /** Cuántos cortes transversales caben en la franja; el axial dibuja esas mismas líneas. */
  sectionCount: number;
  /** Olvida todo: al salir del estudio no debe quedar nada de la serie anterior. */
  reset: () => void;
  ensureSeries: (uid: string) => SeriesDentalState;
  update: (uid: string, patch: Partial<SeriesDentalState>) => void;
  setDock: (patch: {
    activeUid?: string | null;
    open?: boolean;
    maximized?: boolean;
    sectionCount?: number;
  }) => void;
  addArchPoint: (uid: string, point: Vec3, index?: number) => void;
  moveArchPoint: (uid: string, index: number, point: Vec3) => void;
  undoArchPoint: (uid: string) => void;
  clearArch: (uid: string) => void;
  addNervePoint: (uid: string, nerve: NerveId, point: Vec3) => void;
  moveNervePoint: (uid: string, nerve: NerveId, index: number, point: Vec3) => void;
  undoNervePoint: (uid: string, nerve: NerveId) => void;
  clearNerve: (uid: string, nerve: NerveId) => void;
  setTool: (uid: string, tool: DockTool) => void;
  setSlab: (uid: string, slabMm: number) => void;
  /** Añade un extremo de regla; con el segundo, en la misma vista y corte, la cierra. */
  addRulerPoint: (uid: string, point: PendingRulerPoint) => void;
  removeRuler: (uid: string, id: number) => void;
}

export function emptySeriesState(): SeriesDentalState {
  return {
    ready: false,
    loading: null,
    error: null,
    arch: [],
    nerves: { R: [], L: [] },
    cursorS: null,
    slabMm: DEFAULT_SLAB_MM,
    projection: 'avg',
    sectionSpacingMm: DEFAULT_SECTION_SPACING_MM,
    sectionWidthMm: DEFAULT_SECTION_WIDTH_MM,
    tool: 'navigate',
    pending: null,
    rulers: [],
    nextRulerId: 1,
    panoWl: null,
    crossWl: null,
  };
}

export const useDentalStore = create<DentalStoreState>()((set, get) => {
  const patchSeries = (uid: string, fn: (s: SeriesDentalState) => Partial<SeriesDentalState>) =>
    set(state => {
      const current = state.bySeries[uid] ?? emptySeriesState();
      return { bySeries: { ...state.bySeries, [uid]: { ...current, ...fn(current) } } };
    });

  return {
    bySeries: {},
    activeUid: null,
    dockOpen: false,
    dockMaximized: false,
    sectionCount: 1,

    reset: () =>
      set({
        bySeries: {},
        activeUid: null,
        dockOpen: false,
        dockMaximized: false,
        sectionCount: 1,
      }),

    ensureSeries: uid => {
      const existing = get().bySeries[uid];
      if (existing) {
        return existing;
      }
      const created = emptySeriesState();
      set(state => ({ bySeries: { ...state.bySeries, [uid]: created } }));
      return created;
    },

    update: (uid, patch) => patchSeries(uid, () => patch),

    setDock: ({ activeUid, open, maximized, sectionCount }) =>
      set(state => ({
        activeUid: activeUid === undefined ? state.activeUid : activeUid,
        dockOpen: open === undefined ? state.dockOpen : open,
        dockMaximized: maximized === undefined ? state.dockMaximized : maximized,
        sectionCount: sectionCount === undefined ? state.sectionCount : sectionCount,
      })),

    addArchPoint: (uid, point, index) =>
      patchSeries(uid, s => {
        const arch = [...s.arch];
        if (index === undefined || index >= arch.length) {
          arch.push(point);
        } else {
          arch.splice(Math.max(0, index), 0, point);
        }
        return { arch };
      }),

    moveArchPoint: (uid, index, point) =>
      patchSeries(uid, s => {
        if (index < 0 || index >= s.arch.length) {
          return {};
        }
        const arch = [...s.arch];
        arch[index] = point;
        return { arch };
      }),

    undoArchPoint: uid => patchSeries(uid, s => ({ arch: s.arch.slice(0, -1) })),

    // Sin arco no hay sistema de referencia: se van también el canal y las reglas.
    clearArch: uid =>
      patchSeries(uid, () => ({
        arch: [],
        nerves: { R: [], L: [] },
        rulers: [],
        pending: null,
        cursorS: null,
        tool: 'navigate',
      })),

    addNervePoint: (uid, nerve, point) =>
      patchSeries(uid, s => ({ nerves: { ...s.nerves, [nerve]: [...s.nerves[nerve], point] } })),

    moveNervePoint: (uid, nerve, index, point) =>
      patchSeries(uid, s => {
        if (index < 0 || index >= s.nerves[nerve].length) {
          return {};
        }
        const points = [...s.nerves[nerve]];
        points[index] = point;
        return { nerves: { ...s.nerves, [nerve]: points } };
      }),

    undoNervePoint: (uid, nerve) =>
      patchSeries(uid, s => ({ nerves: { ...s.nerves, [nerve]: s.nerves[nerve].slice(0, -1) } })),

    clearNerve: (uid, nerve) => patchSeries(uid, s => ({ nerves: { ...s.nerves, [nerve]: [] } })),

    setTool: (uid, tool) => patchSeries(uid, () => ({ tool, pending: null })),

    setSlab: (uid, slabMm) =>
      patchSeries(uid, () => ({ slabMm: Math.min(MAX_SLAB_MM, Math.max(0, slabMm)) })),

    addRulerPoint: (uid, point) =>
      patchSeries(uid, s => {
        const first = s.pending;
        const sameSection =
          first &&
          first.view === point.view &&
          (point.view === 'pano' ||
            Math.abs((first.sectionS ?? 0) - (point.sectionS ?? 0)) <= SAME_SECTION_TOLERANCE_MM);
        // Un segundo clic en otra vista u otro corte empieza una regla nueva:
        // una regla entre dos planos distintos no se puede dibujar ni leer.
        if (!first || !sameSection) {
          return { pending: point };
        }
        const ruler: DentalRuler = {
          id: s.nextRulerId,
          view: point.view,
          points: [first.point, point.point],
          sectionS: point.view === 'cross' ? first.sectionS : null,
        };
        return {
          rulers: [...s.rulers, ruler],
          nextRulerId: s.nextRulerId + 1,
          pending: null,
        };
      }),

    removeRuler: (uid, id) =>
      patchSeries(uid, s => ({ rulers: s.rulers.filter(r => r.id !== id) })),
  };
});
