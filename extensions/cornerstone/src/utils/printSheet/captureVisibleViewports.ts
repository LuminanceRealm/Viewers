import html2canvas from 'html2canvas';

/**
 * Rasterizes the viewports that are currently mounted on screen, exactly as the
 * user sees them (window level, zoom/pan, annotations and overlays included).
 *
 * html2canvas is used rather than `canvas.toDataURL` because the annotations
 * live in an SVG layer on top of the cornerstone canvas — the same reason
 * CornerstoneViewportDownloadForm uses it.
 */
export default async function captureVisibleViewports(viewportIds: string[]): Promise<string[]> {
  const images: string[] = [];

  for (const viewportId of viewportIds) {
    const element = document.querySelector(`div[data-viewport-uid="${viewportId}"]`) as HTMLElement;

    if (!element) {
      continue;
    }

    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#000000',
        logging: false,
        scale: Math.max(window.devicePixelRatio || 1, 2),
      });

      images.push(canvas.toDataURL('image/jpeg', 0.92));
    } catch (error) {
      console.error('Print: could not rasterize viewport', viewportId, error);
    }
  }

  return images;
}
