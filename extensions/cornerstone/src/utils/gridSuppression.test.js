import { detectGridPattern, suppressGridPattern } from './gridSuppression';

const rows = 600;
const cols = 640;

function phantom({ axis = 'x', frequency = 0.39, amplitude = 25 } = {}) {
  const px = new Uint16Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Fondo con gradiente, un "órgano" circular y un poco de ruido determinista.
      let v = 300 + 0.3 * c + 0.2 * r;
      const d = Math.hypot(r - 300, c - 320);
      if (d < 120) {
        v += 250;
      }
      v += ((r * 7919 + c * 104729) % 17) - 8;
      if (axis) {
        const t = axis === 'x' ? c : r;
        v += amplitude * Math.cos(2 * Math.PI * frequency * t + 0.7);
      }
      px[r * cols + c] = Math.round(v);
    }
  }
  return px;
}

describe('detectGridPattern', () => {
  it('encuentra líneas verticales y su frecuencia', () => {
    const p = detectGridPattern(phantom(), rows, cols);
    expect(p.axis).toBe('x');
    expect(p.frequency).toBeCloseTo(0.39, 2);
  });

  it('encuentra líneas horizontales', () => {
    const p = detectGridPattern(phantom({ axis: 'y', frequency: 0.33 }), rows, cols);
    expect(p.axis).toBe('y');
    expect(p.frequency).toBeCloseTo(0.33, 2);
  });

  it('no inventa rejilla en una imagen sin patrón', () => {
    expect(detectGridPattern(phantom({ axis: null }), rows, cols)).toBeNull();
  });
});

describe('suppressGridPattern', () => {
  it('quita el patrón y deja la anatomía', () => {
    const clean = phantom({ axis: null });
    const px = phantom();
    const pattern = detectGridPattern(px, rows, cols);
    suppressGridPattern(px, rows, cols, pattern, 0, 4095);

    expect(detectGridPattern(px, rows, cols)).toBeNull();

    // Lejos de los bordes del órgano el resultado vuelve a la imagen limpia.
    let err = 0;
    let n = 0;
    for (let r = 100; r < 500; r++) {
      for (let c = 60; c < 580; c++) {
        const d = Math.hypot(r - 300, c - 320);
        if (Math.abs(d - 120) < 12) {
          continue;
        }
        err += Math.abs(px[r * cols + c] - clean[r * cols + c]);
        n++;
      }
    }
    expect(err / n).toBeLessThan(3); // el patrón tenía amplitud 25
  });

  it('respeta el rango de valores', () => {
    const px = phantom();
    const pattern = detectGridPattern(px, rows, cols);
    suppressGridPattern(px, rows, cols, pattern, 320, 700);
    expect(px.reduce((m, v) => Math.min(m, v), Infinity)).toBeGreaterThanOrEqual(320);
    expect(px.reduce((m, v) => Math.max(m, v), -Infinity)).toBeLessThanOrEqual(700);
  });
});
