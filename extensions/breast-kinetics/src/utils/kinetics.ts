import { DELAYED_THRESHOLD_PCT, INITIAL_MEDIUM_MAX_PCT, INITIAL_SLOW_MAX_PCT } from '../constants';

export type InitialCategory = 'slow' | 'medium' | 'rapid';
export type CurveType = 1 | 2 | 3;

export interface KineticsResult {
  /** Media basal (fase 0). */
  s0: number;
  /** Media de la primera fase post-contraste. */
  s1: number;
  /** Media de la última fase. */
  sn: number;
  /** (S1 − S0) / S0 × 100 */
  initialPct: number | null;
  initialCategory: InitialCategory | null;
  /** (Sn − S1) / S1 × 100 */
  delayedPct: number | null;
  type: CurveType | null;
  /** Realce relativo por fase, (Si − S0) / S0 × 100. */
  relativePct: (number | null)[];
  /** Por qué no se clasificó, si aplica. */
  reason: string | null;
}

export const CURVE_TYPE_LABELS: Record<CurveType, string> = {
  1: 'Tipo I · persistente',
  2: 'Tipo II · meseta',
  3: 'Tipo III · lavado',
};

export const INITIAL_LABELS: Record<InitialCategory, string> = {
  slow: 'lento',
  medium: 'medio',
  rapid: 'rápido',
};

export function initialCategory(pct: number): InitialCategory {
  if (pct < INITIAL_SLOW_MAX_PCT) {
    return 'slow';
  }
  if (pct <= INITIAL_MEDIUM_MAX_PCT) {
    return 'medium';
  }
  return 'rapid';
}

export function curveType(delayedPct: number): CurveType {
  if (delayedPct >= DELAYED_THRESHOLD_PCT) {
    return 1;
  }
  if (delayedPct <= -DELAYED_THRESHOLD_PCT) {
    return 3;
  }
  return 2;
}

/**
 * Métricas cinéticas BI-RADS a partir de las medias por fase (fase 0 = basal).
 * Con S0 ≤ 0 o menos de tres fases se devuelven las medias pero sin clasificar.
 */
export function computeKinetics(means: (number | null)[]): KineticsResult {
  const valid = means.filter((m): m is number => m !== null && Number.isFinite(m));
  const s0 = valid[0] ?? NaN;
  const s1 = valid[1] ?? NaN;
  const sn = valid[valid.length - 1] ?? NaN;

  const relativePct = means.map(m =>
    m === null || !Number.isFinite(m) || !(s0 > 0) ? null : ((m - s0) / s0) * 100
  );

  const base: KineticsResult = {
    s0,
    s1,
    sn,
    initialPct: null,
    initialCategory: null,
    delayedPct: null,
    type: null,
    relativePct,
    reason: null,
  };

  if (valid.length < 3) {
    return { ...base, reason: 'Se necesitan al menos tres fases (basal y dos post-contraste).' };
  }
  if (!(s0 > 0)) {
    return { ...base, reason: 'La media basal es cero o negativa; no se puede normalizar.' };
  }
  if (!(s1 > 0)) {
    return { ...base, reason: 'La primera fase post-contraste no tiene señal.' };
  }

  const initialPct = ((s1 - s0) / s0) * 100;
  const delayedPct = ((sn - s1) / s1) * 100;
  return {
    ...base,
    initialPct,
    initialCategory: initialCategory(initialPct),
    delayedPct,
    type: curveType(delayedPct),
  };
}
