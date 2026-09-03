import {
  findPhaseCandidates,
  splitSeriesIntoPhases,
  orderPhases,
  parseDicomTime,
  summarizeGeometry,
  timeAxis,
} from './phaseMatching';

function series(uid: string, overrides: Record<string, unknown> = {}, instanceOverrides = {}) {
  const instances = Array.from({ length: 5 }, (_, i) => ({
    imageId: `dicomweb:${uid}/${i}`,
    FrameOfReferenceUID: 'FOR-1',
    Rows: 512,
    Columns: 512,
    PixelSpacing: [0.7, 0.7],
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    ImagePositionPatient: [-100, -120, 10 + i * 2],
    ImageType: ['ORIGINAL', 'PRIMARY'],
    InstanceNumber: i + 1,
    ...instanceOverrides,
  }));
  return {
    displaySetInstanceUID: uid,
    StudyInstanceUID: 'STUDY',
    Modality: 'MR',
    SeriesNumber: Number(uid.replace(/\D/g, '')) || 0,
    SeriesDescription: `dyn ${uid}`,
    instances,
    ...overrides,
  };
}

describe('summarizeGeometry', () => {
  it('resume orientación, espaciado y extremos ordenados por la normal', () => {
    const g = summarizeGeometry(series('s1'));
    expect(g).not.toBeNull();
    expect(g!.count).toBe(5);
    expect(g!.firstPosition[2]).toBe(10);
    expect(g!.lastPosition[2]).toBe(18);
  });

  it('acepta valores como cadenas DICOM', () => {
    const g = summarizeGeometry(
      series('s1', {}, { PixelSpacing: '0.7\\0.7', ImageOrientationPatient: '1\\0\\0\\0\\1\\0' })
    );
    expect(g!.pixelSpacing).toEqual([0.7, 0.7]);
  });

  it('devuelve null sin posiciones', () => {
    expect(summarizeGeometry(series('s1', {}, { ImagePositionPatient: undefined }))).toBeNull();
  });
});

describe('findPhaseCandidates', () => {
  const ref = series('s10');

  it('acepta series con geometría idéntica y rechaza las distintas', () => {
    const all = [
      ref,
      series('s11'),
      series('s12', {}, { ImageOrientationPatient: [0, 1, 0, 0, 0, -1] }),
      series('s13', {}, { ImagePositionPatient: [-100, -120, 50] }),
      { ...series('s14'), instances: series('s14').instances.slice(0, 4) },
      series('s15', { Modality: 'CT' }),
      series('s16', { StudyInstanceUID: 'OTRO' }),
      series('s17', {}, { FrameOfReferenceUID: 'FOR-2' }),
    ];
    const uids = findPhaseCandidates(all, ref).map(c => c.displaySetInstanceUID);
    expect(uids).toEqual(['s10', 's11']);
  });

  it('marca derivadas por ImageType o descripción, pero nunca la referencia', () => {
    const all = [
      series('s10', { SeriesDescription: 'SUB dyn' }),
      series('s11', {}, { ImageType: ['DERIVED', 'SECONDARY'] }),
      series('s12', { SeriesDescription: 'MIP ax' }),
      series('s13'),
    ];
    const byUid = Object.fromEntries(
      findPhaseCandidates(all, all[0]).map(c => [c.displaySetInstanceUID, c.derived])
    );
    expect(byUid).toEqual({ s10: false, s11: true, s12: true, s13: false });
  });
});

describe('parseDicomTime', () => {
  it('parsea HHMMSS.FFFFFF y variantes cortas', () => {
    expect(parseDicomTime('101530.250000')).toBeCloseTo(10 * 3600 + 15 * 60 + 30.25);
    expect(parseDicomTime('1015')).toBe(10 * 3600 + 15 * 60);
    expect(parseDicomTime('10')).toBe(36000);
    expect(parseDicomTime(undefined)).toBeNull();
    expect(parseDicomTime('abc')).toBeNull();
    expect(parseDicomTime('250000')).toBeNull();
  });
});

describe('orderPhases y timeAxis', () => {
  it('ordena por hora cuando todas la traen y difieren', () => {
    const ordered = orderPhases([
      { displaySetInstanceUID: 'b', seriesNumber: 2, acquisitionSeconds: 100 },
      { displaySetInstanceUID: 'a', seriesNumber: 5, acquisitionSeconds: 50 },
      { displaySetInstanceUID: 'c', seriesNumber: 1, acquisitionSeconds: 200 },
    ]);
    expect(ordered.map(p => p.displaySetInstanceUID)).toEqual(['a', 'b', 'c']);
  });

  it('cae al número de serie si las horas faltan o son iguales', () => {
    const same = orderPhases([
      { displaySetInstanceUID: 'b', seriesNumber: 2, acquisitionSeconds: 100 },
      { displaySetInstanceUID: 'a', seriesNumber: 1, acquisitionSeconds: 100 },
    ]);
    expect(same.map(p => p.displaySetInstanceUID)).toEqual(['a', 'b']);
    const missing = orderPhases([
      { displaySetInstanceUID: 'b', seriesNumber: 2, acquisitionSeconds: null },
      { displaySetInstanceUID: 'a', seriesNumber: 1, acquisitionSeconds: 300 },
    ]);
    expect(missing.map(p => p.displaySetInstanceUID)).toEqual(['a', 'b']);
  });

  it('timeAxis devuelve segundos relativos o null', () => {
    expect(timeAxis([100, 190, 280])).toEqual([0, 90, 180]);
    expect(timeAxis([100, 100, 100])).toBeNull();
    expect(timeAxis([100, null, 300])).toBeNull();
    expect(timeAxis([])).toBeNull();
    // cruce de medianoche
    expect(timeAxis([86390, 20])).toEqual([0, 30]);
  });
});

describe('splitSeriesIntoPhases', () => {
  function multiphase(phases: number, slices: number, phaseMajor = true) {
    const instances = [];
    for (let t = 0; t < phases; t++) {
      for (let k = 0; k < slices; k++) {
        const n = phaseMajor ? t * slices + k + 1 : k * phases + t + 1;
        instances.push({
          imageId: `dicomweb:dyn/${n}`,
          InstanceNumber: n,
          ImagePositionPatient: [-100, -120, 10 + k * 2],
          ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
          PixelSpacing: [0.75, 0.75],
          Rows: 400,
          Columns: 400,
          FrameOfReferenceUID: 'FOR-1',
        });
      }
    }
    // desordenadas a propósito
    instances.sort(() => 0.3 - Math.random());
    return {
      displaySetInstanceUID: 'dyn',
      StudyInstanceUID: 'STUDY',
      Modality: 'MR',
      SeriesNumber: 301,
      SeriesDescription: 'Perfusion_Axial',
      instances,
    };
  }

  it('parte una serie con posiciones repetidas en fases ordenadas por InstanceNumber', () => {
    const phases = splitSeriesIntoPhases(multiphase(6, 150));
    expect(phases).toHaveLength(6);
    phases.forEach((p, t) => {
      expect(p.imageIds).toHaveLength(150);
      expect(p.phaseIndex).toBe(t);
      expect(p.label).toBe(`Fase ${t + 1} · S301`);
    });
    // fase 0 = instancias 1..150 en orden phase-major
    expect(phases[0].imageIds).toContain('dicomweb:dyn/1');
    expect(phases[0].imageIds).not.toContain('dicomweb:dyn/151');
    expect(phases[5].imageIds).toContain('dicomweb:dyn/900');
  });

  it('también funciona con orden slice-major', () => {
    const phases = splitSeriesIntoPhases(multiphase(4, 10, false));
    expect(phases).toHaveLength(4);
    // corte 0: instancias 1,2,3,4 → fase t recibe la (t+1)
    expect(phases[0].imageIds).toContain('dicomweb:dyn/1');
    expect(phases[3].imageIds).toContain('dicomweb:dyn/4');
  });

  it('no parte una serie normal ni una con multiplicidad desigual', () => {
    expect(splitSeriesIntoPhases(series('s1'))).toEqual([]);
    const uneven = multiphase(2, 5);
    uneven.instances.pop();
    expect(splitSeriesIntoPhases(uneven)).toEqual([]);
  });

  it('findPhaseCandidates prefiere las fases intra-serie', () => {
    const dyn = multiphase(3, 20);
    const candidates = findPhaseCandidates([dyn, series('s99')], dyn);
    expect(candidates).toHaveLength(3);
    expect(candidates.every(c => c.displaySetInstanceUID === 'dyn')).toBe(true);
  });
});
