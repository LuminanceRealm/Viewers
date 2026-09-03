import { closestSliceIndex, estimateShiftPx, meanInDisc } from './roiSampling';

function image(rows: number, cols: number, fill: (r: number, c: number) => number) {
  const pixels = new Int16Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pixels[r * cols + c] = fill(r, c);
    }
  }
  return { pixels, rows, cols };
}

describe('meanInDisc', () => {
  it('devuelve el valor del disco cuando la ROI cae dentro de él', () => {
    const img = image(64, 64, (r, c) => ((r - 30) ** 2 + (c - 30) ** 2 <= 100 ? 500 : 50));
    const { mean, count } = meanInDisc(img, [30, 30], [6, 6]);
    expect(mean).toBe(500);
    expect(count).toBeGreaterThan(100);
  });

  it('aplica slope e intercept y respeta el borde de la imagen', () => {
    const img = { ...image(10, 10, () => 10), slope: 2, intercept: 5 };
    const { mean, count } = meanInDisc(img, [0, 0], [3, 3]);
    expect(mean).toBe(25);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(30);
  });

  it('radios anisótropos muestrean una elipse', () => {
    const img = image(40, 40, (r, c) => (Math.abs(r - 20) <= 2 ? 100 : 0));
    // radio grande en columnas, pequeño en filas: se queda en la banda de 100
    expect(meanInDisc(img, [20, 20], [2, 10]).mean).toBe(100);
    // al revés, sale de la banda
    expect(meanInDisc(img, [20, 20], [10, 2]).mean).toBeLessThan(100);
  });

  it('radio nulo → sin media', () => {
    expect(
      meanInDisc(
        image(4, 4, () => 1),
        [1, 1],
        [0, 0]
      )
    ).toEqual({ mean: null, count: 0 });
  });
});

describe('closestSliceIndex', () => {
  const positions: [number, number, number][] = [0, 1, 2, 3, 4].map(k => [0, 0, k * 2]);
  it('elige el corte más cercano a lo largo de la normal', () => {
    expect(closestSliceIndex(positions, [0, 0, 1], [10, -5, 4.9])).toBe(2);
    expect(closestSliceIndex(positions, [0, 0, 1], [0, 0, 7.2])).toBe(4);
  });
  it('rechaza si está más lejos que la tolerancia', () => {
    expect(closestSliceIndex(positions, [0, 0, 1], [0, 0, 20], 1)).toBe(-1);
  });
});

describe('estimateShiftPx', () => {
  const blob = (r0: number, c0: number) =>
    image(96, 96, (r, c) => 1000 * Math.exp(-((r - r0) ** 2 + (c - c0) ** 2) / 40) + 200);

  it('recupera un desplazamiento conocido aunque cambie el nivel global', () => {
    const base = blob(48, 48);
    const moved = blob(51, 44);
    moved.pixels.forEach((v, i) => (moved.pixels[i] = v + 300)); // realce uniforme
    expect(estimateShiftPx(base, moved, [48, 48])).toEqual([3, -4]);
  });

  it('cero si no hay movimiento', () => {
    expect(estimateShiftPx(blob(48, 48), blob(48, 48), [48, 48])).toEqual([0, 0]);
  });

  it('null si el parche no cabe', () => {
    expect(estimateShiftPx(blob(48, 48), blob(48, 48), [5, 5])).toBeNull();
  });
});
