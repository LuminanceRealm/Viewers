import { computeKinetics, curveType, initialCategory } from './kinetics';

describe('initialCategory', () => {
  it('usa los cortes de 50 % y 100 %', () => {
    expect(initialCategory(49.9)).toBe('slow');
    expect(initialCategory(50)).toBe('medium');
    expect(initialCategory(100)).toBe('medium');
    expect(initialCategory(100.1)).toBe('rapid');
  });
});

describe('curveType', () => {
  it('clasifica con el umbral de ±10 %', () => {
    expect(curveType(10)).toBe(1);
    expect(curveType(9.9)).toBe(2);
    expect(curveType(-9.9)).toBe(2);
    expect(curveType(-10)).toBe(3);
  });
});

describe('computeKinetics', () => {
  it('tipo I: realce rápido y ascenso persistente', () => {
    const r = computeKinetics([100, 220, 250, 270]);
    expect(r.initialPct).toBeCloseTo(120);
    expect(r.initialCategory).toBe('rapid');
    expect(r.delayedPct).toBeCloseTo((270 - 220) / 2.2);
    expect(r.type).toBe(1);
    expect(r.relativePct.map(v => Math.round(v as number))).toEqual([0, 120, 150, 170]);
    expect(r.reason).toBeNull();
  });

  it('tipo II: meseta', () => {
    const r = computeKinetics([100, 180, 185, 175]);
    expect(r.type).toBe(2);
    expect(r.initialCategory).toBe('medium');
  });

  it('tipo III: lavado', () => {
    const r = computeKinetics([100, 260, 230, 200]);
    expect(r.type).toBe(3);
    expect(r.delayedPct).toBeLessThan(-10);
  });

  it('no clasifica con dos fases ni con basal cero', () => {
    expect(computeKinetics([100, 200]).type).toBeNull();
    expect(computeKinetics([100, 200]).reason).toMatch(/tres fases/);
    const zero = computeKinetics([0, 200, 300]);
    expect(zero.type).toBeNull();
    expect(zero.relativePct).toEqual([null, null, null]);
  });

  it('ignora fases sin valor pero conserva su hueco en relativePct', () => {
    const r = computeKinetics([100, null, 200, 210]);
    expect(r.s1).toBe(200);
    expect(r.relativePct.map(v => (v === null ? null : Math.round(v)))).toEqual([
      0,
      null,
      100,
      110,
    ]);
    expect(r.type).toBe(2);
  });
});
