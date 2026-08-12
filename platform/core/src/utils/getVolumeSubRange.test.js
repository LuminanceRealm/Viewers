import getVolumeSubRange from './getVolumeSubRange';

describe('getVolumeSubRange', () => {
  describe('series that fit', () => {
    it('returns null when the series is smaller than the limit', () => {
      expect(getVolumeSubRange({ numImages: 200, maxSlices: 2048 })).toBeNull();
    });

    it('returns null when the series exactly fills the limit', () => {
      expect(getVolumeSubRange({ numImages: 2048, maxSlices: 2048 })).toBeNull();
    });
  });

  describe('when the limit is unknown', () => {
    // Truncating a study because we could not read the GPU limit would be a
    // worse outcome than the blank viewport we are trying to avoid.
    it.each([
      ['undefined', undefined],
      ['zero', 0],
      ['negative', -1],
      ['Infinity', Infinity],
      ['NaN', NaN],
    ])('returns null when maxSlices is %s', (_label, maxSlices) => {
      expect(getVolumeSubRange({ numImages: 5000, maxSlices })).toBeNull();
    });
  });

  describe('series that exceed the limit', () => {
    it('reconstructs exactly the number of slices the GPU allows', () => {
      const range = getVolumeSubRange({ numImages: 2400, maxSlices: 1024 });

      expect(range).not.toBeNull();
      expect(range.count).toBe(1024);
      expect(range.end - range.start).toBe(1024);
      expect(range.total).toBe(2400);
    });

    it('centres on the middle of the series when no slice is in focus', () => {
      const range = getVolumeSubRange({ numImages: 2400, maxSlices: 1024 });

      // Middle is 1200, so the window spans 688..1712.
      expect(range.start).toBe(688);
      expect(range.end).toBe(1712);
    });

    it('centres on the slice the reader was looking at', () => {
      const range = getVolumeSubRange({ numImages: 2400, maxSlices: 1024, focusIndex: 1800 });

      expect(range.start).toBe(1288);
      expect(range.end).toBe(2312);
    });
  });

  describe('clamping', () => {
    it('does not run past the start when focused near the beginning', () => {
      const range = getVolumeSubRange({ numImages: 2400, maxSlices: 1024, focusIndex: 10 });

      expect(range.start).toBe(0);
      expect(range.count).toBe(1024);
    });

    it('does not run past the end when focused near the end', () => {
      const range = getVolumeSubRange({ numImages: 2400, maxSlices: 1024, focusIndex: 2399 });

      expect(range.end).toBe(2400);
      expect(range.count).toBe(1024);
    });

    it('falls back to the middle when focusIndex is out of bounds', () => {
      const range = getVolumeSubRange({ numImages: 2400, maxSlices: 1024, focusIndex: 99999 });

      expect(range.start).toBe(688);
    });
  });
});
