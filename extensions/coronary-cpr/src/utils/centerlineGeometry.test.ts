import {
  arcLength,
  buildOrientedCenterline,
  dot,
  distance,
  frameToQuaternion,
  length,
  resampleCatmullRom,
  rotateFrames,
  rotateVecByQuat,
  rotationMinimizingFrames,
} from './centerlineGeometry';
import type { Vec3 } from '../constants';

const control: Vec3[] = [
  [0, 0, 0],
  [10, 5, 2],
  [20, 0, 6],
  [30, -4, 12],
  [40, 0, 20],
];

describe('resampleCatmullRom', () => {
  it('pasa por los puntos de control y respeta el paso', () => {
    const step = 0.5;
    const samples = resampleCatmullRom(control, step);
    expect(samples[0]).toEqual(control[0]);
    expect(distance(samples[samples.length - 1], control[control.length - 1])).toBeLessThan(0.3);
    for (let i = 1; i < samples.length - 1; i++) {
      expect(distance(samples[i - 1], samples[i])).toBeCloseTo(step, 2);
    }
    control.forEach(p => {
      const nearest = Math.min(...samples.map(s => distance(s, p)));
      expect(nearest).toBeLessThan(step);
    });
  });

  it('con dos puntos es la recta entre ellos', () => {
    const samples = resampleCatmullRom([control[0], [10, 0, 0]], 1);
    expect(samples.length).toBe(11);
    samples.forEach(s => {
      expect(s[1]).toBeCloseTo(0, 6);
      expect(s[2]).toBeCloseTo(0, 6);
    });
    expect(arcLength(samples)).toBeCloseTo(10, 6);
  });

  it('con menos de dos puntos devuelve copia', () => {
    expect(resampleCatmullRom([], 1)).toEqual([]);
    expect(resampleCatmullRom([[1, 2, 3]], 1)).toEqual([[1, 2, 3]]);
  });
});

describe('rotationMinimizingFrames', () => {
  const samples = resampleCatmullRom(control, 0.5);
  const frames = rotationMinimizingFrames(samples);

  it('produce marcos ortonormales', () => {
    frames.forEach(({ t, u, v }) => {
      expect(length(t)).toBeCloseTo(1, 6);
      expect(length(u)).toBeCloseTo(1, 6);
      expect(length(v)).toBeCloseTo(1, 6);
      expect(Math.abs(dot(t, u))).toBeLessThan(1e-6);
      expect(Math.abs(dot(t, v))).toBeLessThan(1e-6);
      expect(Math.abs(dot(u, v))).toBeLessThan(1e-6);
    });
  });

  it('gira lo mínimo entre muestras consecutivas', () => {
    for (let i = 1; i < frames.length; i++) {
      expect(dot(frames[i - 1].u, frames[i].u)).toBeGreaterThan(0.99);
    }
  });

  it('rotar θ conserva la tangente y gira u hacia v', () => {
    const rotated = rotateFrames(frames, 90);
    rotated.forEach((f, i) => {
      expect(f.t).toEqual(frames[i].t);
      expect(dot(f.u, frames[i].v)).toBeCloseTo(1, 6);
    });
  });
});

describe('frameToQuaternion', () => {
  it('lleva X→u, Y→v, Z→t', () => {
    const frames = rotationMinimizingFrames(resampleCatmullRom(control, 1));
    frames.forEach(f => {
      const q = frameToQuaternion(f);
      const x = rotateVecByQuat([1, 0, 0], q);
      const y = rotateVecByQuat([0, 1, 0], q);
      const z = rotateVecByQuat([0, 0, 1], q);
      expect(distance(x, f.u)).toBeLessThan(1e-5);
      expect(distance(y, f.v)).toBeLessThan(1e-5);
      expect(distance(z, f.t)).toBeLessThan(1e-5);
    });
  });
});

describe('buildOrientedCenterline', () => {
  it('empaqueta muestras y quats con longitud coherente', () => {
    const built = buildOrientedCenterline(control, 0.5, 30);
    expect(built).not.toBeNull();
    const n = built!.samples.length;
    expect(built!.points.length).toBe(n * 3);
    expect(built!.orientations.length).toBe(n * 4);
    expect(built!.lengthMm).toBeGreaterThan(40);
  });

  it('devuelve null sin trazado útil', () => {
    expect(buildOrientedCenterline([], 0.5, 0)).toBeNull();
    expect(buildOrientedCenterline([[0, 0, 0]], 0.5, 0)).toBeNull();
    expect(
      buildOrientedCenterline(
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        0.5,
        0
      )
    ).toBeNull();
  });
});
