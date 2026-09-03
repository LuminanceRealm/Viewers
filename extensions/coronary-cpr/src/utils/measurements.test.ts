import {
  buildOrientedCenterline,
  frameToQuaternion,
  rotationMinimizingFrames,
} from './centerlineGeometry';
import { lengthMm, projectToStrip, stenosis, stripToWorld, StripGeometry } from './measurements';
import type { Vec3 } from '../constants';

describe('lengthMm y stenosis', () => {
  it('regla: distancia 3D real', () => {
    expect(
      lengthMm([
        [0, 0, 0],
        [3, 4, 0],
      ])
    ).toBe(5);
    expect(lengthMm([[0, 0, 0]])).toBeNull();
  });

  it('estenosis: referencia, mínimo y porcentaje', () => {
    const s = stenosis([
      [0, 0, 0],
      [4, 0, 0],
      [0, 0, 10],
      [1, 0, 10],
    ]);
    expect(s!.referenceMm).toBe(4);
    expect(s!.minimalMm).toBe(1);
    expect(s!.percent).toBe(75);
    expect(
      stenosis([
        [0, 0, 0],
        [1, 0, 0],
      ])
    ).toBeNull();
  });
});

describe('projectToStrip / stripToWorld', () => {
  const control: Vec3[] = [
    [0, 0, 0],
    [10, 4, 2],
    [20, 0, 6],
    [30, -3, 12],
  ];
  const built = buildOrientedCenterline(control, 0.5, 0)!;
  const distances: number[] = [];
  let acc = 0;
  for (let i = 0; i < built.samples.length; i++) {
    if (i > 0) {
      const a = built.samples[i - 1];
      const b = built.samples[i];
      acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    distances.push(acc);
  }
  const geometry: StripGeometry = {
    points: built.points,
    orientations: built.orientations,
    distances,
  };

  it('ida y vuelta: un punto lateral se recupera con su distancia y desplazamiento', () => {
    const i = 30;
    const sample = built.samples[i];
    const q = frameToQuaternion(built.frames[i]);
    const world = stripToWorld(sample, q, 7.5);
    const strip = projectToStrip(world, geometry)!;
    expect(strip.distance).toBeCloseTo(distances[i], 6);
    expect(strip.lateral).toBeCloseTo(7.5, 5);
    expect(strip.offPlane).toBeLessThan(1e-6);
  });

  it('un punto fuera del plano reporta su distancia al plano', () => {
    const i = 12;
    const f = built.frames[i];
    const world: Vec3 = [
      built.samples[i][0] + f.v[0] * 3,
      built.samples[i][1] + f.v[1] * 3,
      built.samples[i][2] + f.v[2] * 3,
    ];
    const strip = projectToStrip(world, geometry)!;
    expect(strip.offPlane).toBeCloseTo(3, 5);
    expect(Math.abs(strip.lateral)).toBeLessThan(1e-6);
  });

  it('con orientación uniforme usa el marco del primer punto', () => {
    const frames = rotationMinimizingFrames(built.samples);
    const q0 = frameToQuaternion(frames[0]);
    const uniform: StripGeometry = { ...geometry, uniformOrientation: q0 };
    const world = stripToWorld(built.samples[5], q0, 2);
    const strip = projectToStrip(world, uniform)!;
    expect(strip.lateral).toBeCloseTo(2, 5);
  });

  it('geometría vacía → null', () => {
    expect(
      projectToStrip([0, 0, 0], {
        points: new Float32Array(),
        orientations: new Float32Array(),
        distances: [],
      })
    ).toBeNull();
  });
});
