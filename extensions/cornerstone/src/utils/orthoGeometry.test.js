import {
  acetabularIndex,
  angleAtVertex,
  columnDirection,
  distanceToLine,
  mechanicalAxis,
} from './orthoGeometry';

// Imagen AP convencional: x mundo = columna, y mundo = fila (hacia abajo), 1 mm/píxel.
const idx = p => [p[0], p[1], 0];

describe('columnDirection', () => {
  it('lee la componente izquierda/derecha de PatientOrientation', () => {
    expect(columnDirection('L\\F')).toBe('L');
    expect(columnDirection(['R', 'F'])).toBe('R');
    expect(columnDirection('LP\\F')).toBe('L');
  });
  it('asume la convención radiográfica si falta', () => {
    expect(columnDirection(undefined)).toBe('L');
    expect(columnDirection('')).toBe('L');
  });
});

describe('geometría básica', () => {
  it('ángulo en el vértice', () => {
    expect(angleAtVertex([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(angleAtVertex([0, -1, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(180);
  });
  it('distancia a una recta', () => {
    expect(distanceToLine([3, 5, 0], [0, 0, 0], [0, 10, 0])).toBeCloseTo(3);
  });
});

describe('acetabularIndex', () => {
  // Hilgenreiner horizontal en la fila 100; techos que suben 20° y 30° hacia fuera.
  const yLeftOfImage = [80, 100, 0];
  const yRightOfImage = [120, 100, 0];
  const tan20 = Math.tan((20 * Math.PI) / 180);
  const tan30 = Math.tan((30 * Math.PI) / 180);
  const edgeLeftOfImage = [80 - 30, 100 - 30 * tan20, 0];
  const edgeRightOfImage = [120 + 30, 100 - 30 * tan30, 0];

  it('mide cada lado y asigna derecha a la izquierda de la imagen', () => {
    const r = acetabularIndex({
      triradiateA: yLeftOfImage,
      triradiateB: yRightOfImage,
      edge1: edgeLeftOfImage,
      edge2: edgeRightOfImage,
      indexTriradiateA: idx(yLeftOfImage),
      indexTriradiateB: idx(yRightOfImage),
      columnDir: 'L',
    });
    expect(r.right.angle).toBeCloseTo(20);
    expect(r.left.angle).toBeCloseTo(30);
  });

  it('no depende del orden de los clics', () => {
    const r = acetabularIndex({
      triradiateA: yRightOfImage,
      triradiateB: yLeftOfImage,
      edge1: edgeLeftOfImage,
      edge2: edgeRightOfImage,
      indexTriradiateA: idx(yRightOfImage),
      indexTriradiateB: idx(yLeftOfImage),
      columnDir: 'L',
    });
    expect(r.right.angle).toBeCloseTo(20);
    expect(r.left.angle).toBeCloseTo(30);
  });

  it('respeta una imagen volteada (columnas hacia la derecha del paciente)', () => {
    const r = acetabularIndex({
      triradiateA: yLeftOfImage,
      triradiateB: yRightOfImage,
      edge1: edgeLeftOfImage,
      edge2: edgeRightOfImage,
      indexTriradiateA: idx(yLeftOfImage),
      indexTriradiateB: idx(yRightOfImage),
      columnDir: 'R',
    });
    expect(r.left.angle).toBeCloseTo(20);
    expect(r.right.angle).toBeCloseTo(30);
  });
});

describe('mechanicalAxis', () => {
  const columns = 1000;
  // Miembro derecho del paciente (izquierda de la imagen): cadera en x=300, tobillo en x=320.
  const hip = [300, 100, 0];
  const ankle = [320, 900, 0];
  const onLineKneeX = 310; // la recta cadera-tobillo pasa por x=310 a la altura y=500
  const base = {
    hip,
    ankle,
    indexHip: idx(hip),
    indexAnkle: idx(ankle),
    imageColumns: columns,
    columnDir: 'L',
  };

  it('rodilla hacia fuera de la línea media es varo', () => {
    const knee = [onLineKneeX - 20, 500, 0]; // más lejos del centro (x=500)
    const r = mechanicalAxis({ ...base, knee, indexKnee: idx(knee) });
    expect(r.side).toBe('R');
    expect(r.alignment).toBe('varus');
    expect(r.hka).toBeLessThan(180);
    expect(r.mad).toBeGreaterThan(19);
  });

  it('rodilla hacia la línea media es valgo', () => {
    const knee = [onLineKneeX + 20, 500, 0];
    const r = mechanicalAxis({ ...base, knee, indexKnee: idx(knee) });
    expect(r.alignment).toBe('valgus');
  });

  it('en el miembro izquierdo el sentido se invierte', () => {
    const lh = [700, 100, 0];
    const la = [680, 900, 0];
    const knee = [690 + 20, 500, 0]; // hacia fuera = columnas mayores
    const r = mechanicalAxis({
      hip: lh,
      ankle: la,
      knee,
      indexHip: idx(lh),
      indexAnkle: idx(la),
      indexKnee: idx(knee),
      imageColumns: columns,
      columnDir: 'L',
    });
    expect(r.side).toBe('L');
    expect(r.alignment).toBe('varus');
  });

  it('eje recto es neutro', () => {
    const knee = [onLineKneeX, 500, 0];
    const r = mechanicalAxis({ ...base, knee, indexKnee: idx(knee) });
    expect(r.deviation).toBeCloseTo(0);
    expect(r.alignment).toBe('neutral');
  });

  it('un miembro centrado no permite decidir el lado', () => {
    const ch = [495, 100, 0];
    const ca = [505, 900, 0];
    const knee = [480, 500, 0];
    const r = mechanicalAxis({
      hip: ch,
      ankle: ca,
      knee,
      indexHip: idx(ch),
      indexAnkle: idx(ca),
      indexKnee: idx(knee),
      imageColumns: columns,
      columnDir: 'L',
    });
    expect(r.alignment).toBeNull();
    expect(r.side).toBeNull();
    expect(r.deviation).toBeGreaterThan(0);
  });
});
