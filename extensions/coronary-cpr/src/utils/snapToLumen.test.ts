import { snapToLumen } from './snapToLumen';
import { distance } from './centerlineGeometry';
import type { Vec3 } from '../constants';

/** Fantasma: cilindro de lumen (350 HU) a lo largo de z, centrado en (cx, cy), radio r. */
function cylinderField(cx: number, cy: number, r: number, hu = 350) {
  return {
    minSpacingMm: 0.34,
    huAtWorld: ([x, y]: Vec3) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? hu : 40),
  };
}

describe('snapToLumen', () => {
  const normal: Vec3 = [0, 0, 1];

  it('lleva el clic al centro del lumen cuando cae dentro', () => {
    const field = cylinderField(3, 0, 1.5);
    const snapped = snapToLumen(field, [2.2, 0.4, 5], normal);
    expect(distance(snapped, [3, 0, 5])).toBeLessThan(0.2);
    expect(snapped[2]).toBeCloseTo(5, 6);
  });

  it('salta al lumen más cercano si el clic cae justo fuera', () => {
    const field = cylinderField(3, 0, 1.2);
    const snapped = snapToLumen(field, [1.2, 0, 0], normal, { radiusMm: 2.5 });
    expect(distance(snapped, [3, 0, 0])).toBeLessThan(0.5);
  });

  it('devuelve el clic si no hay contraste alrededor', () => {
    const field = { minSpacingMm: 0.34, huAtWorld: () => 40 };
    expect(snapToLumen(field, [1, 2, 3], normal)).toEqual([1, 2, 3]);
  });

  it('ignora el calcio denso por encima del rango', () => {
    const field = cylinderField(0, 0, 1.5, 900);
    expect(snapToLumen(field, [0.5, 0, 0], normal)).toEqual([0.5, 0, 0]);
  });

  it('funciona con normales oblicuas y mantiene el punto en el plano', () => {
    const oblique: Vec3 = [0.3, 0.2, 0.93];
    const field = {
      minSpacingMm: 0.34,
      // lumen: esfera de radio 1.5 en (3, 0, 0); el plano por (2, 0, 0) la corta
      huAtWorld: ([x, y, z]: Vec3) => ((x - 3) ** 2 + y ** 2 + z ** 2 <= 2.25 ? 350 : 40),
    };
    const click: Vec3 = [2, 0, 0];
    const snapped = snapToLumen(field, click, oblique);
    const d = snapped.map((v, i) => v - click[i]);
    const off = d[0] * oblique[0] + d[1] * oblique[1] + d[2] * oblique[2];
    expect(Math.abs(off) / Math.hypot(...oblique)).toBeLessThan(1e-6);
    expect(distance(snapped, [3, 0, 0])).toBeLessThan(distance(click, [3, 0, 0]));
  });
});
