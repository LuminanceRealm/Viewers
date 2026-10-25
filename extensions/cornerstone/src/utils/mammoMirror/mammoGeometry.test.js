import {
  anatomicalToImage,
  cameraForFraming,
  findTissueBounds,
  framingFromBounds,
  unionFraming,
  chestWallImageSide,
  classifyMammoDisplaySet,
  displayFlips,
  imageToAnatomical,
  mirrorImagePoint,
  parsePatientOrientation,
} from './mammoGeometry';

// Metadatos tal como los manda el manifiesto para la mamografía Fuji 1153278:
// sin ViewPosition ni ViewCodeSequence, con ImageLaterality y PatientOrientation.
const fuji = (ImageLaterality, PatientOrientation, extra = {}) => ({
  Modality: 'MG',
  numImageFrames: 1,
  images: [{ Modality: 'MG', ImageLaterality, PatientOrientation, ...extra }],
});

describe('parsePatientOrientation', () => {
  it('acepta arreglo y cadena DICOM', () => {
    expect(parsePatientOrientation(['P', 'FL'])).toEqual(['P', 'FL']);
    expect(parsePatientOrientation('a\\r')).toEqual(['A', 'R']);
  });
  it('rechaza valores incompletos', () => {
    expect(parsePatientOrientation(undefined)).toBeUndefined();
    expect(parsePatientOrientation(['P'])).toBeUndefined();
    expect(parsePatientOrientation('')).toBeUndefined();
  });
});

describe('classifyMammoDisplaySet', () => {
  it('reconoce las cuatro proyecciones del estudio Fuji sólo con el manifiesto', () => {
    expect(classifyMammoDisplaySet(fuji('R', ['P', 'L'])).code).toBe('RCC');
    expect(classifyMammoDisplaySet(fuji('L', ['A', 'R'])).code).toBe('LCC');
    expect(classifyMammoDisplaySet(fuji('R', ['P', 'FL'])).code).toBe('RMLO');
    expect(classifyMammoDisplaySet(fuji('L', ['A', 'FR'])).code).toBe('LMLO');
  });

  it('prefiere ViewPosition y ViewCodeSequence cuando vienen', () => {
    expect(classifyMammoDisplaySet(fuji('R', ['P', 'FL'], { ViewPosition: 'CC' })).view).toBe('CC');
    expect(
      classifyMammoDisplaySet(
        fuji('L', undefined, { ViewCodeSequence: [{ CodeValue: 'R-10226' }] })
      ).view
    ).toBe('MLO');
  });

  it('deja fuera las proyecciones adicionales', () => {
    expect(classifyMammoDisplaySet(fuji('R', ['P', 'F'], { ViewPosition: 'ML' }))).toBeUndefined();
    expect(classifyMammoDisplaySet(fuji('R', ['P', 'F']))).toBeUndefined();
  });

  it('deja fuera la tomosíntesis y las series con más de una imagen', () => {
    // Multiframe: una instancia con muchos cortes.
    expect(
      classifyMammoDisplaySet({ ...fuji('R', ['P', 'L']), numImageFrames: 60 })
    ).toBeUndefined();
    // Una instancia por corte.
    const perSlice = fuji('R', ['P', 'L']);
    perSlice.images = Array.from({ length: 60 }, () => perSlice.images[0]);
    perSlice.numImageFrames = 60;
    expect(classifyMammoDisplaySet(perSlice)).toBeUndefined();
  });

  it('exige mamografía con lado', () => {
    expect(classifyMammoDisplaySet({ ...fuji('R', ['P', 'L']), Modality: 'DX' })).toBeUndefined();
    expect(classifyMammoDisplaySet(fuji('', ['P', 'L']))).toBeUndefined();
    expect(classifyMammoDisplaySet(fuji('B', ['P', 'L']))).toBeUndefined();
  });
});

describe('orientación de presentación', () => {
  it('ubica la pared torácica', () => {
    expect(chestWallImageSide(['P', 'L'])).toBe('right');
    expect(chestWallImageSide(['A', 'R'])).toBe('left');
    expect(chestWallImageSide(undefined)).toBeUndefined();
  });

  it('las imágenes Fuji ya vienen en presentación estándar', () => {
    const flips = (lat, po) => displayFlips(classifyMammoDisplaySet(fuji(lat, po)), po);
    const none = { flipHorizontal: false, flipVertical: false };
    expect(flips('R', ['P', 'L'])).toEqual(none);
    expect(flips('L', ['A', 'R'])).toEqual(none);
    expect(flips('R', ['P', 'FL'])).toEqual(none);
    expect(flips('L', ['A', 'FR'])).toEqual(none);
  });

  it('voltea cuando la imagen llega al revés', () => {
    const rcc = { laterality: 'R', view: 'CC', code: 'RCC' };
    const lmlo = { laterality: 'L', view: 'MLO', code: 'LMLO' };
    expect(displayFlips(rcc, ['A', 'R'])).toEqual({ flipHorizontal: true, flipVertical: true });
    expect(displayFlips(lmlo, ['P', 'HR'])).toEqual({ flipHorizontal: true, flipVertical: true });
  });
});

describe('espejo', () => {
  const right = {
    columns: 4728,
    rows: 5928,
    columnSpacing: 0.05,
    rowSpacing: 0.05,
    chestWall: 'right',
    flipVertical: false,
  };
  const left = { ...right, chestWall: 'left' };

  it('ida y vuelta conserva el punto', () => {
    const p = [1234, 4321];
    const back = anatomicalToImage(right, imageToAnatomical(right, p));
    expect(back[0]).toBeCloseTo(p[0]);
    expect(back[1]).toBeCloseTo(p[1]);
  });

  it('refleja respecto a la pared torácica y conserva la altura', () => {
    // 10 mm de la pared en la derecha (columna 4528) → 10 mm en la izquierda (columna 200).
    const [column, row] = mirrorImagePoint(right, left, [4528, 1000]);
    expect(column).toBeCloseTo(200);
    expect(row).toBeCloseTo(1000);
  });

  it('alinea imágenes de distinto tamaño por la pared y el centro', () => {
    const small = { ...left, columns: 2000, rows: 3000, columnSpacing: 0.1, rowSpacing: 0.1 };
    // Centro vertical de una → centro vertical de la otra; 20 mm de la pared en ambas.
    const [column, row] = mirrorImagePoint(right, small, [4728 - 400, 2964]);
    expect(column).toBeCloseTo(200);
    expect(row).toBeCloseTo(1500);
  });

  it('respeta un volteo vertical de la cámara', () => {
    const flipped = { ...left, flipVertical: true };
    // 100 filas por encima del centro en pantalla siguen arriba en la otra.
    const [, row] = mirrorImagePoint(right, flipped, [4000, 2964 - 100]);
    expect(row).toBeCloseTo(2964 + 100);
  });
});

// Fantoma tipo MONOCHROME1: fondo alto, mama semielíptica pegada a la pared
// derecha (columna 399) y una etiqueta "R CC" suelta en el fondo.
function phantom({ columns = 400, rows = 500, wall = 'right', depth = 220, half = 150 } = {}) {
  const pixels = new Uint16Array(columns * rows).fill(4000);
  const centerRow = rows / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const d = wall === 'right' ? columns - 1 - c : c;
      const dr = (r - centerRow) / half;
      if (dr * dr + (d / depth) * (d / depth) <= 1) {
        pixels[r * columns + c] = 1500;
      }
    }
  }
  // Etiqueta: 12×30 px lejos de la pared, arriba.
  for (let r = 40; r < 52; r++) {
    for (let c = 0; c < 30; c++) {
      const col = wall === 'right' ? 20 + c : columns - 50 + c;
      pixels[r * columns + col] = 0;
    }
  }
  return { pixels, columns, rows };
}

describe('encuadre de la mama', () => {
  it('encuentra el tejido sin contar la etiqueta', () => {
    const { pixels, columns, rows } = phantom();
    const bounds = findTissueBounds(pixels, columns, rows, 'right');
    expect(bounds.fromWall).toBeGreaterThanOrEqual(215);
    expect(bounds.fromWall).toBeLessThan(240);
    expect(bounds.top).toBeGreaterThan(95);
    expect(bounds.top).toBeLessThan(110);
    expect(bounds.bottom).toBeGreaterThan(390);
    expect(bounds.bottom).toBeLessThan(405);
  });

  it('funciona con la pared a la izquierda', () => {
    const { pixels, columns, rows } = phantom({ wall: 'left' });
    expect(findTissueBounds(pixels, columns, rows, 'left').fromWall).toBeGreaterThanOrEqual(215);
  });

  it('se rinde con una imagen sin mama', () => {
    const pixels = new Uint16Array(400 * 500).fill(4000);
    expect(findTissueBounds(pixels, 400, 500, 'right')).toBeUndefined();
  });

  it('pone la pared en el borde interior y el tejido llena la vista', () => {
    const frame = {
      columns: 400,
      rows: 500,
      columnSpacing: 0.1,
      rowSpacing: 0.1,
      chestWall: 'right',
      flipVertical: false,
    };
    const framing = framingFromBounds(frame, { fromWall: 220, top: 100, bottom: 400 });
    // Vista alta (teléfono): manda el ancho.
    const tall = cameraForFraming(framing, 100, 400);
    expect(tall.parallelScale * 2 * (100 / 400)).toBeCloseTo(framing.uMax);
    expect(tall.center[0]).toBeCloseTo(framing.uMax / 2);
    // Vista ancha (escritorio): manda la altura; la pared sigue en el borde.
    const wide = cameraForFraming(framing, 800, 400);
    expect(wide.parallelScale).toBeCloseTo((framing.vMax - framing.vMin) / 2);
    expect(wide.center[0]).toBeCloseTo(wide.parallelScale * 2);
  });

  it('el par comparte el marco más grande', () => {
    const a = { uMax: 10, vMin: -5, vMax: 5 };
    const b = { uMax: 12, vMin: -4, vMax: 7 };
    expect(unionFraming(a, b)).toEqual({ uMax: 12, vMin: -5, vMax: 7 });
    expect(unionFraming(a)).toBe(a);
  });
});
