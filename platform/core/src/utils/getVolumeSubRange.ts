/**
 * A volume viewport uploads the whole series as a single 3D texture. WebGL caps
 * every texture dimension at MAX_3D_TEXTURE_SIZE, so a series with more slices
 * than that limit fails with
 *
 *   WebGL: INVALID_VALUE: texImage3D: width, height or depth out of range
 *
 * and the viewport stays blank. This is a dimension limit, not a memory one, so
 * no amount of cache tuning or reduced texture precision avoids it: the only
 * way through is a volume with fewer slices.
 *
 * We reconstruct a contiguous sub-range at native resolution rather than
 * subsampling every Nth slice. Subsampling multiplies the Z spacing, so a bad
 * calculation yields a normal-looking image with wrong measurements — a silent,
 * clinically misleading failure. A sub-range keeps the native spacing, so
 * geometry and measurements stay exact, and what it loses (the ends of the
 * study) is plainly visible to whoever is reading it.
 */

export type VolumeSubRange = {
  /** Index of the first slice included, into the original imageIds array. */
  start: number;
  /** Index just past the last slice included. */
  end: number;
  /** Number of slices reconstructed. */
  count: number;
  /** Number of slices in the full series. */
  total: number;
};

/**
 * Works out whether a series exceeds the GPU's 3D texture depth and, if so,
 * which contiguous slice range to reconstruct instead.
 *
 * The range is centred on `focusIndex` so the reconstruction covers wherever
 * the reader was already looking, falling back to the middle of the series when
 * no slice is in focus. It is then clamped so it never runs past either end.
 *
 * @param numImages - Slices in the full series.
 * @param maxSlices - Most slices this GPU can hold, i.e. MAX_3D_TEXTURE_SIZE.
 * @param focusIndex - Slice to centre on; defaults to the middle of the series.
 * @returns The range to reconstruct, or null when the series fits whole (the
 *          overwhelmingly common case, where nothing should change).
 */
export default function getVolumeSubRange({
  numImages,
  maxSlices,
  focusIndex,
}: {
  numImages: number;
  maxSlices?: number;
  focusIndex?: number;
}): VolumeSubRange | null {
  // Without a usable limit we cannot claim the series won't fit, and wrongly
  // truncating a study is worse than leaving today's behaviour alone.
  if (!maxSlices || !Number.isFinite(maxSlices) || maxSlices < 1) {
    return null;
  }

  if (!Number.isFinite(numImages) || numImages <= maxSlices) {
    return null;
  }

  const count = Math.floor(maxSlices);

  const centre =
    Number.isFinite(focusIndex) && focusIndex >= 0 && focusIndex < numImages
      ? Math.floor(focusIndex)
      : Math.floor(numImages / 2);

  // Centre the window on the slice of interest, then slide it back inside the
  // series so we never index past either end.
  const start = Math.min(Math.max(centre - Math.floor(count / 2), 0), numImages - count);

  return {
    start,
    end: start + count,
    count,
    total: numImages,
  };
}
