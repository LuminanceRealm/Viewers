import { computeAgatston, densityFactor, riskCategory } from './agatston';
import { collectComponent3D } from './floodFill3D';

const W = 8;
const H = 8;

function blankSlice(fill = -1000) {
  const labels = new Uint8Array(W * H);
  const hu = new Float32Array(W * H).fill(fill);
  return { labels, huArr: hu, hu: (idx: number) => hu[idx] };
}

function paint(slice, segment: number, cells: [number, number][], value: number) {
  cells.forEach(([i, j]) => {
    slice.labels[j * W + i] = segment;
    slice.huArr[j * W + i] = value;
  });
}

describe('densityFactor', () => {
  it('sigue la escala de Agatston', () => {
    expect(densityFactor(129)).toBe(0);
    expect(densityFactor(130)).toBe(1);
    expect(densityFactor(199)).toBe(1);
    expect(densityFactor(200)).toBe(2);
    expect(densityFactor(299)).toBe(2);
    expect(densityFactor(300)).toBe(3);
    expect(densityFactor(399)).toBe(3);
    expect(densityFactor(400)).toBe(4);
    expect(densityFactor(1500)).toBe(4);
  });
});

describe('riskCategory', () => {
  it('clasifica por el total', () => {
    expect(riskCategory(0).key).toBe('none');
    expect(riskCategory(5).key).toBe('minimal');
    expect(riskCategory(50).key).toBe('mild');
    expect(riskCategory(250).key).toBe('moderate');
    expect(riskCategory(401).key).toBe('severe');
  });
});

describe('computeAgatston', () => {
  it('puntúa una lesión de 3×3 píxeles a 0.5 mm con pico de 250 HU en cortes de 3 mm', () => {
    const slice = blankSlice();
    paint(
      slice,
      2,
      [
        [2, 2],
        [3, 2],
        [4, 2],
        [2, 3],
        [3, 3],
        [4, 3],
        [2, 4],
        [3, 4],
        [4, 4],
      ],
      180
    );
    slice.huArr[3 * W + 3] = 250; // pico en el centro

    const result = computeAgatston({
      width: W,
      height: H,
      slices: [slice],
      pixelSpacing: [0.5, 0.5],
      sliceIncrementMm: 3,
    });

    const da = result.perSegment[2];
    // 9 px × 0.25 mm² = 2.25 mm²; factor 2 por 250 HU; normalización 1.
    expect(da.areaMm2).toBeCloseTo(2.25);
    expect(da.score).toBeCloseTo(4.5);
    expect(da.volumeMm3).toBeCloseTo(2.25 * 3);
    expect(da.peakHU).toBe(250);
    expect(da.lesions).toBe(1);
    expect(result.total.score).toBeCloseTo(4.5);
    expect(result.perSegment[1].score).toBe(0);
  });

  it('descarta lesiones menores al área mínima pero conserva su volumen', () => {
    const slice = blankSlice();
    paint(slice, 4, [[1, 1]], 500); // 1 px = 0.25 mm² < 1 mm²

    const result = computeAgatston({
      width: W,
      height: H,
      slices: [slice],
      pixelSpacing: [0.5, 0.5],
      sliceIncrementMm: 3,
    });

    expect(result.perSegment[4].score).toBe(0);
    expect(result.perSegment[4].areaMm2).toBe(0);
    expect(result.perSegment[4].volumeMm3).toBeCloseTo(0.75);
  });

  it('normaliza el score al espesor de 3 mm y cuenta lesiones en 3D', () => {
    const a = blankSlice();
    const b = blankSlice();
    const cells: [number, number][] = [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ];
    paint(a, 3, cells, 450);
    paint(b, 3, cells, 450); // misma placa continúa al corte siguiente

    const result = computeAgatston({
      width: W,
      height: H,
      slices: [a, b],
      pixelSpacing: [1, 1],
      sliceIncrementMm: 1.5,
    });

    const cx = result.perSegment[3];
    // Por corte: 4 mm² × factor 4 × (1.5 / 3) = 8; dos cortes = 16.
    expect(cx.score).toBeCloseTo(16);
    expect(cx.lesions).toBe(1);
    expect(result.sliceNormalization).toBeCloseTo(0.5);
  });

  it('cuenta lesiones separadas en el mismo corte como distintas', () => {
    const slice = blankSlice();
    paint(
      slice,
      1,
      [
        [0, 0],
        [1, 0],
      ],
      300
    );
    paint(
      slice,
      1,
      [
        [6, 6],
        [7, 7],
      ],
      300
    ); // diagonal: 8-vecinos → una sola componente

    const result = computeAgatston({
      width: W,
      height: H,
      slices: [slice],
      pixelSpacing: [1, 1],
      sliceIncrementMm: 3,
    });

    expect(result.perSegment[1].lesions).toBe(2);
  });
});

describe('collectComponent3D', () => {
  it('recorre vecinos en 26 direcciones y respeta los límites', () => {
    const depth = 3;
    const slices = Array.from({ length: depth }, () => new Uint8Array(W * H));
    slices[0][0] = 5;
    slices[1][W + 1] = 5; // diagonal en las tres dimensiones
    slices[2][2 * W + 2] = 5;
    slices[2][7 * W + 7] = 5; // aislado

    const grid = { width: W, height: H, depth, get: (k, idx) => slices[k][idx] };
    const component = collectComponent3D(grid, 0, 0, v => v === 5);

    expect(component.map(c => c.k)).toEqual([0, 1, 2]);
    expect(component.reduce((n, c) => n + c.indices.length, 0)).toBe(3);
    expect(collectComponent3D(grid, 0, 5, v => v === 5)).toEqual([]);
  });
});
