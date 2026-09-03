import { create } from 'zustand';

import { DEFAULT_RADIUS_MM, MAX_RADIUS_MM, MIN_RADIUS_MM, Vec3 } from '../constants';
import type { TimeSource } from '../utils/imageTimes';

export interface PhaseState {
  displaySetInstanceUID: string;
  seriesNumber: number;
  description: string;
  imageCount: number;
  derived: boolean;
  imageIds: string[];
  phaseIndex?: number;
  label: string;
  /** Participa en la curva. */
  active: boolean;
  /** Segundos desde medianoche leídos del archivo; null si no vinieron. */
  acquisitionSeconds: number | null;
  timeSource: TimeSource;
}

export interface RoiState {
  id: number;
  /** Índice de color en la paleta (orden fijo de creación). */
  colorIndex: number;
  center: Vec3;
  /** Normal del plano del corte donde se marcó. */
  normal: Vec3;
  radiusMm: number;
  label: string;
}

export interface StudyKineticsState {
  /** Serie sobre la que se inició la herramienta. */
  referenceUid: string;
  phases: PhaseState[];
  rois: RoiState[];
  activeRoiId: number | null;
  nextRoiId: number;
  radiusMm: number;
  ready: boolean;
  error: string | null;
}

interface KineticsStoreState {
  byStudy: Record<string, StudyKineticsState>;
  init: (studyUid: string, referenceUid: string, phases: PhaseState[]) => void;
  update: (studyUid: string, patch: Partial<StudyKineticsState>) => void;
  togglePhase: (studyUid: string, phaseKey: string) => void;
  setPhaseTime: (
    studyUid: string,
    phaseKey: string,
    acquisitionSeconds: number | null,
    timeSource: TimeSource
  ) => void;
  addRoi: (studyUid: string, center: Vec3, normal: Vec3) => RoiState | null;
  moveRoi: (studyUid: string, roiId: number, center: Vec3) => void;
  removeRoi: (studyUid: string, roiId: number) => void;
  setActiveRoi: (studyUid: string, roiId: number | null) => void;
  setRadius: (studyUid: string, radiusMm: number) => void;
}

/** Identificador estable de una fase: serie, o serie + índice si es multifase. */
export function phaseKey(p: { displaySetInstanceUID: string; phaseIndex?: number }): string {
  return p.phaseIndex === undefined
    ? p.displaySetInstanceUID
    : `${p.displaySetInstanceUID}#${p.phaseIndex}`;
}

export function emptyStudyState(referenceUid = ''): StudyKineticsState {
  return {
    referenceUid,
    phases: [],
    rois: [],
    activeRoiId: null,
    nextRoiId: 1,
    radiusMm: DEFAULT_RADIUS_MM,
    ready: false,
    error: null,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const useKineticsStore = create<KineticsStoreState>()((set, get) => {
  const patch = (studyUid: string, fn: (s: StudyKineticsState) => Partial<StudyKineticsState>) =>
    set(state => {
      const current = state.byStudy[studyUid] ?? emptyStudyState();
      return { byStudy: { ...state.byStudy, [studyUid]: { ...current, ...fn(current) } } };
    });

  return {
    byStudy: {},

    init: (studyUid, referenceUid, phases) =>
      patch(studyUid, s => ({
        referenceUid,
        phases,
        // Las ROIs sobreviven a un re-emparejamiento de fases.
        rois: s.rois,
        ready: true,
        error: null,
      })),

    update: (studyUid, p) => patch(studyUid, () => p),

    togglePhase: (studyUid, key) =>
      patch(studyUid, s => ({
        phases: s.phases.map(p => (phaseKey(p) === key ? { ...p, active: !p.active } : p)),
      })),

    setPhaseTime: (studyUid, key, acquisitionSeconds, timeSource) =>
      patch(studyUid, s => ({
        phases: s.phases.map(p =>
          phaseKey(p) === key ? { ...p, acquisitionSeconds, timeSource } : p
        ),
      })),

    addRoi: (studyUid, center, normal) => {
      const s = get().byStudy[studyUid];
      if (!s) {
        return null;
      }
      const roi: RoiState = {
        id: s.nextRoiId,
        colorIndex: s.nextRoiId - 1,
        center,
        normal,
        radiusMm: s.radiusMm,
        label: `ROI ${s.nextRoiId}`,
      };
      patch(studyUid, st => ({
        rois: [...st.rois, roi],
        activeRoiId: roi.id,
        nextRoiId: st.nextRoiId + 1,
      }));
      return roi;
    },

    moveRoi: (studyUid, roiId, center) =>
      patch(studyUid, s => ({
        rois: s.rois.map(r => (r.id === roiId ? { ...r, center } : r)),
      })),

    removeRoi: (studyUid, roiId) =>
      patch(studyUid, s => ({
        rois: s.rois.filter(r => r.id !== roiId),
        activeRoiId: s.activeRoiId === roiId ? null : s.activeRoiId,
      })),

    setActiveRoi: (studyUid, roiId) => patch(studyUid, () => ({ activeRoiId: roiId })),

    setRadius: (studyUid, radiusMm) =>
      patch(studyUid, s => {
        const r = clamp(radiusMm, MIN_RADIUS_MM, MAX_RADIUS_MM);
        return {
          radiusMm: r,
          // El radio nuevo se aplica a la ROI activa; las demás conservan el suyo.
          rois: s.rois.map(roi => (roi.id === s.activeRoiId ? { ...roi, radiusMm: r } : roi)),
        };
      }),
  };
});
