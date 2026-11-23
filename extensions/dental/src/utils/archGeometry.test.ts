import {
  archPointAt,
  archToWorld,
  buildArch,
  nerveAtS,
  nervePath,
  resampleSpline,
  rulerLengthMm,
  worldToArch,
} from './archGeometry';

// Rejilla axial estándar (LPS): filas hacia la izquierda del paciente (+x),
// columnas hacia posterior (+y), normal hacia la cabeza (+z).
const axes = {
  origin: [-80, -80, 0] as [number, number, number],
  rowCos: [1, 0, 0] as [number, number, number],
  colCos: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

/** Arcada en U: semicírculo de 30 mm de radio abierto hacia posterior (+y). */
function horseshoe(fromPatientLeft: boolean, z = 12) {
  const pts: [number, number, number][] = [];
  for (let n = 0; n <= 8; n++) {
    const angle = (Math.PI * n) / 8; // 0 = derecha del paciente (x negativo)
    pts.push([-30 * Math.cos(angle), -30 * Math.sin(angle), z]);
  }
  return fromPatientLeft ? pts.reverse() : pts;
}

describe('resampleSpline', () => {
  it('deja las muestras a paso uniforme', () => {
    const pts = resampleSpline(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      0.5
    );
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      expect(d).toBeCloseTo(0.5, 2);
    }
    expect(pts[0]).toEqual([0, 0]);
  });
});

describe('buildArch', () => {
  it('mide la longitud de un semicírculo', () => {
    const arch = buildArch(horseshoe(false), axes, 0.25);
    expect(arch.lengthMm).toBeGreaterThan(Math.PI * 30 * 0.985);
    expect(arch.lengthMm).toBeLessThan(Math.PI * 30 * 1.005);
  });

  it('empieza siempre en la derecha del paciente, se trace como se trace', () => {
    const a = buildArch(horseshoe(false), axes, 0.25);
    const b = buildArch(horseshoe(true), axes, 0.25);
    expect(a.reversed).toBe(false);
    expect(b.reversed).toBe(true);
    [a, b].forEach(arch => {
      const first = archToWorld(arch, axes, { s: 0, o: 0, c: 0 });
      const last = archToWorld(arch, axes, { s: arch.lengthMm, o: 0, c: 0 });
      expect(first[0]).toBeLessThan(-25);
      expect(last[0]).toBeGreaterThan(25);
    });
  });

  it('orienta la normal hacia vestibular (afuera del arco)', () => {
    const arch = buildArch(horseshoe(true), axes, 0.25);
    // En el centro del arco (incisivos), afuera es anterior: y más negativo.
    const mid = archPointAt(arch, arch.lengthMm / 2);
    const out = archToWorld(arch, axes, { s: arch.lengthMm / 2, o: 5, c: 0 });
    const on = archToWorld(arch, axes, { s: arch.lengthMm / 2, o: 0, c: 0 });
    expect(out[1]).toBeLessThan(on[1] - 4.9);
    expect(Math.hypot(mid.na, mid.nb)).toBeCloseTo(1, 6);
  });

  it('no arma arco con menos de dos puntos', () => {
    expect(buildArch([[0, 0, 0]], axes, 0.25)).toBeNull();
  });
});

describe('coordenadas de arco', () => {
  const arch = buildArch(horseshoe(false), axes, 0.25);

  it('ida y vuelta devuelve el mismo punto', () => {
    [
      { s: 10, o: 3, c: 20 },
      { s: 47.1, o: -6, c: 4 },
      { s: 80, o: 0, c: 33 },
    ].forEach(coords => {
      const back = worldToArch(arch, axes, archToWorld(arch, axes, coords));
      expect(back.s).toBeCloseTo(coords.s, 1);
      expect(back.o).toBeCloseTo(coords.o, 1);
      expect(back.c).toBeCloseTo(coords.c, 6);
    });
  });

  it('un punto a 5 mm por fuera del semicírculo está a 35 mm del centro', () => {
    const p = archToWorld(arch, axes, { s: 30, o: 5, c: 0 });
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(35, 0);
  });
});

describe('canal', () => {
  const arch = buildArch(horseshoe(false), axes, 0.25);
  const mark = (s: number, o: number, c: number) => archToWorld(arch, axes, { s, o, c });

  it('ordena los puntos a lo largo del arco e interpola entre ellos', () => {
    // Marcados en desorden.
    const path = nervePath(arch, axes, [mark(30, -2, 10), mark(10, -4, 20), mark(20, -3, 14)]);
    expect(path[0].s).toBeCloseTo(10, 0);
    expect(path[path.length - 1].s).toBeGreaterThan(29);
    const at = nerveAtS(path, 20);
    expect(at.o).toBeCloseTo(-3, 0);
    expect(at.c).toBeCloseTo(14, 0);
  });

  it('no inventa canal fuera del tramo marcado', () => {
    const path = nervePath(arch, axes, [mark(10, -4, 20), mark(30, -2, 10)]);
    expect(nerveAtS(path, 5)).toBeNull();
    expect(nerveAtS(path, 40)).toBeNull();
  });
});

describe('regla', () => {
  const arch = buildArch(horseshoe(false), axes, 0.25);

  it('en un corte da la distancia real en 3D', () => {
    const pw = archToWorld(arch, axes, { s: 40, o: -5, c: 10 });
    const qw = archToWorld(arch, axes, { s: 40, o: 7, c: 26 });
    const p = worldToArch(arch, axes, pw);
    const q = worldToArch(arch, axes, qw);
    expect(rulerLengthMm('cross', p, q, pw, qw)).toBeCloseTo(20, 1);
  });

  it('en la panorámica mide sobre la curva, no la cuerda', () => {
    const pw = archToWorld(arch, axes, { s: 0, o: 0, c: 10 });
    const qw = archToWorld(arch, axes, { s: arch.lengthMm, o: 0, c: 10 });
    const p = worldToArch(arch, axes, pw);
    const q = worldToArch(arch, axes, qw);
    const onCurve = rulerLengthMm('pano', p, q, pw, qw);
    expect(onCurve).toBeCloseTo(arch.lengthMm, 0);
    // La cuerda del semicírculo es el diámetro.
    expect(Math.hypot(qw[0] - pw[0], qw[1] - pw[1])).toBeCloseTo(60, 0);
  });
});
