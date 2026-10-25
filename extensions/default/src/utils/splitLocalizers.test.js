import splitLocalizers from './splitLocalizers';

const AXIAL = [1, 0, 0, 0, 1, 0];
const CORONAL = [1, 0, 0, 0, 0, -1];

// Como el estudio 1153591: 120 cortes axiales de 512² más un localizador
// coronal de 533×742 en la misma serie.
const slice = (i, extra = {}) => ({
  InstanceNumber: i + 1,
  Rows: 512,
  Columns: 512,
  ImageOrientationPatient: AXIAL,
  ImagePositionPatient: [0, 0, i * 4],
  ...extra,
});
const scout = { InstanceNumber: 0, Rows: 533, Columns: 742, ImageOrientationPatient: CORONAL };

describe('splitLocalizers', () => {
  it('aparta el localizador de los cortes axiales', () => {
    const slices = Array.from({ length: 120 }, (_, i) => slice(i));
    const result = splitLocalizers([scout, ...slices]);
    expect(result.main).toHaveLength(120);
    expect(result.localizers).toEqual([scout]);
  });

  it('tolera la pequeña inclinación de un gantry casi recto', () => {
    const slices = Array.from({ length: 20 }, (_, i) =>
      slice(i, { ImageOrientationPatient: [1, 0, 0.002 * (i % 2), 0, 1, 0] })
    );
    expect(splitLocalizers([scout, ...slices]).main).toHaveLength(20);
  });

  it('no toca una serie homogénea', () => {
    expect(splitLocalizers(Array.from({ length: 10 }, (_, i) => slice(i)))).toBeUndefined();
  });

  it('no parte una serie con muchas imágenes distintas', () => {
    const mixed = Array.from({ length: 10 }, (_, i) =>
      slice(i, i % 2 ? { Rows: 600, Columns: 800 } : {})
    );
    expect(splitLocalizers(mixed)).toBeUndefined();
  });

  it('no actúa en series cortas', () => {
    expect(splitLocalizers([scout, slice(0), slice(1)])).toBeUndefined();
  });
});
