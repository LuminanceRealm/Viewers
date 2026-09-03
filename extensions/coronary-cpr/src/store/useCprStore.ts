import { create } from 'zustand';

import {
  DEFAULT_LEVEL,
  DEFAULT_WIDTH_MM,
  DEFAULT_WINDOW,
  MAX_WIDTH_MM,
  MIN_WIDTH_MM,
  Vec3,
} from '../constants';

export type CprMode = 'straightened' | 'stretched';

export interface SeriesCprState {
  /** Puntos de control por arteria (id 1–4), en coordenadas mundo y en orden ostium → distal. */
  arteries: Record<number, Vec3[]>;
  activeArtery: number;
  widthMm: number;
  angleDeg: number;
  mode: CprMode;
  window: number;
  level: number;
  /** Distancia (mm) desde el primer punto donde está el cursor; null = sin cursor. */
  cursorDistance: number | null;
  snapEnabled: boolean;
  /** El volumen de la serie ya está muestreable (imágenes cargadas). */
  ready: boolean;
  /** Última incidencia visible para el usuario (WebGL, textura, etc.). */
  error: string | null;
}

interface CprStoreState {
  bySeries: Record<string, SeriesCprState>;
  ensureSeries: (uid: string) => SeriesCprState;
  update: (uid: string, patch: Partial<SeriesCprState>) => void;
  setActiveArtery: (uid: string, arteryId: number) => void;
  addPoint: (uid: string, arteryId: number, point: Vec3, index?: number) => void;
  movePoint: (uid: string, arteryId: number, index: number, point: Vec3) => void;
  undoPoint: (uid: string, arteryId: number) => void;
  clearArtery: (uid: string, arteryId: number) => void;
  setWidth: (uid: string, widthMm: number) => void;
  rotate: (uid: string, deltaDeg: number) => void;
  setWindowLevel: (uid: string, window: number, level: number) => void;
}

export function emptySeriesState(): SeriesCprState {
  return {
    arteries: { 1: [], 2: [], 3: [], 4: [] },
    activeArtery: 2,
    widthMm: DEFAULT_WIDTH_MM,
    angleDeg: 0,
    mode: 'straightened',
    window: DEFAULT_WINDOW,
    level: DEFAULT_LEVEL,
    cursorDistance: null,
    snapEnabled: true,
    ready: false,
    error: null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useCprStore = create<CprStoreState>()((set, get) => {
  const patchSeries = (uid: string, fn: (s: SeriesCprState) => Partial<SeriesCprState>) =>
    set(state => {
      const current = state.bySeries[uid] ?? emptySeriesState();
      return { bySeries: { ...state.bySeries, [uid]: { ...current, ...fn(current) } } };
    });

  return {
    bySeries: {},

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

    setActiveArtery: (uid, arteryId) => patchSeries(uid, () => ({ activeArtery: arteryId })),

    addPoint: (uid, arteryId, point, index) =>
      patchSeries(uid, s => {
        const points = [...(s.arteries[arteryId] ?? [])];
        if (index === undefined || index >= points.length) {
          points.push(point);
        } else {
          points.splice(index, 0, point);
        }
        return { arteries: { ...s.arteries, [arteryId]: points } };
      }),

    movePoint: (uid, arteryId, index, point) =>
      patchSeries(uid, s => {
        const points = [...(s.arteries[arteryId] ?? [])];
        if (index < 0 || index >= points.length) {
          return {};
        }
        points[index] = point;
        return { arteries: { ...s.arteries, [arteryId]: points } };
      }),

    undoPoint: (uid, arteryId) =>
      patchSeries(uid, s => ({
        arteries: { ...s.arteries, [arteryId]: (s.arteries[arteryId] ?? []).slice(0, -1) },
      })),

    clearArtery: (uid, arteryId) =>
      patchSeries(uid, s => ({
        arteries: { ...s.arteries, [arteryId]: [] },
        cursorDistance: null,
      })),

    setWidth: (uid, widthMm) =>
      patchSeries(uid, () => ({ widthMm: clamp(widthMm, MIN_WIDTH_MM, MAX_WIDTH_MM) })),

    rotate: (uid, deltaDeg) =>
      patchSeries(uid, s => ({ angleDeg: (((s.angleDeg + deltaDeg) % 360) + 360) % 360 })),

    setWindowLevel: (uid, window, level) =>
      patchSeries(uid, () => ({ window: Math.max(1, window), level })),
  };
});
