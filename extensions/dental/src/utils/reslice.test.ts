import { buildArch } from './archGeometry';
import { autoWindow, panoRays, sampleColumns, sectionRays, SliceStack, toRgba } from './reslice';

const axes = {
  origin: [0, 0, 0] as [number, number, number],
  rowCos: [1, 0, 0] as [number, number, number],
  colCos: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

const NX = 80;
const NY = 60;
const NZ = 20;
const SP = 0.5;

/** Volumen de 40 × 30 × 10 mm cuyo valor es `fn(a, b, k)` (a, b en mm). */
function volume(fn: (a: number, b: number, k: number) => number, upSign: 1 | -1 = 1): SliceStack {
  const slices = [];
  for (let k = 0; k < NZ; k++) {
    const slice = new Float32Array(NX * NY);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        slice[j * NX + i] = fn(i * SP, j * SP, k);
      }
    }
    slices.push(slice);
  }
  return {
    dims: [NX, NY, NZ],
    spacing: [SP, SP, SP],
    slices,
    slope: new Float32Array(NZ).fill(1),
    intercept: new Float32Array(NZ).fill(0),
    upSign,
  };
}

// Arco recto a lo largo de las filas, en b = 15 mm, de a = 5 a a = 35.
const straight = buildArch(
  [
    [5, 15, 0],
    [20, 15, 0],
    [35, 15, 0],
  ],
  axes,
  SP
);

describe('sampleColumns', () => {
  it('la panorámica fina de un arco recto reproduce el plano del volumen', () => {
    const stack = volume((a, b, k) => a + 100 * k);
    const pano = sampleColumns(stack, panoRays(straight, 0), 'avg');
    expect(pano.width).toBe(straight.count);
    expect(pano.height).toBe(NZ);
    // Fila 0 = superior = último corte cuando la normal apunta a la cabeza.
    expect(pano.data[0]).toBeCloseTo(5 + 100 * (NZ - 1), 3);
    expect(pano.data[(NZ - 1) * pano.width + 10]).toBeCloseTo(5 + 10 * SP, 3);
  });

  it('respeta el sentido de los cortes cuando la normal apunta a los pies', () => {
    const stack = volume((a, b, k) => k, -1);
    const pano = sampleColumns(stack, panoRays(straight, 0), 'avg');
    expect(pano.data[0]).toBeCloseTo(0, 5);
    expect(pano.data[(NZ - 1) * pano.width]).toBeCloseTo(NZ - 1, 5);
  });

  it('el grosor promedia o toma el máximo a los dos lados del arco', () => {
    // Lámina brillante de 1 mm centrada en el arco.
    const stack = volume((a, b) => (Math.abs(b - 15) <= 0.5 ? 1000 : 0));
    const avg = sampleColumns(stack, panoRays(straight, 10), 'avg');
    const max = sampleColumns(stack, panoRays(straight, 10), 'max');
    const mid = 5 * avg.width + 20;
    expect(max.data[mid]).toBeCloseTo(1000, 3);
    expect(avg.data[mid]).toBeGreaterThan(80);
    expect(avg.data[mid]).toBeLessThan(250);
  });

  it('aplica pendiente y ordenada de cada corte', () => {
    const stack = volume(() => 10);
    (stack.slope as Float32Array).fill(2);
    (stack.intercept as Float32Array).fill(-1000);
    const pano = sampleColumns(stack, panoRays(straight, 0), 'avg');
    expect(pano.data[3]).toBeCloseTo(-980, 3);
  });

  it('marca como vacío lo que cae fuera del volumen', () => {
    const outside = buildArch(
      [
        [30, 15, 0],
        [45, 15, 0],
        [60, 15, 0],
      ],
      axes,
      SP
    );
    const pano = sampleColumns(
      volume(() => 7),
      panoRays(outside, 0),
      'avg'
    );
    expect(pano.data[0]).toBeCloseTo(7, 5);
    expect(Number.isNaN(pano.data[pano.width - 1])).toBe(true);
    expect(toRgba(pano, { window: 10, level: 5 })[(pano.width - 1) * 4]).toBe(0);
  });
});

describe('sectionRays', () => {
  it('pone vestibular a la izquierda y conserva las distancias', () => {
    // El valor es la posición b: en un arco recto, el corte transversal la recorre.
    const stack = volume((a, b) => b);
    const section = sampleColumns(stack, sectionRays(straight, 15, 20, SP), 'avg');
    expect(section.width).toBe(41);
    const row = 3 * section.width;
    const left = section.data[row];
    const right = section.data[row + section.width - 1];
    expect(Math.abs(right - left)).toBeCloseTo(20, 3);
    expect(section.data[row + 20]).toBeCloseTo(15, 3);
  });
});

describe('autoWindow', () => {
  it('ignora lo que quedó fuera del volumen', () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      data[i] = i < 100 ? NaN : i;
    }
    const wl = autoWindow(data, 0, 1);
    expect(wl.level - wl.window / 2).toBeCloseTo(100, 0);
    expect(autoWindow(new Float32Array(10).fill(NaN))).toBeNull();
  });
});
