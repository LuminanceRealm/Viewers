import { Enums as csEnums, StackViewport, Types as CoreTypes } from '@cornerstonejs/core';

const OFFSCREEN_VIEWPORT_ID = 'ohif-print-sheet-offscreen';

type CaptureOptions = {
  renderingEngine: CoreTypes.IRenderingEngine;
  imageIds: string[];
  /** Properties (VOI, invert, colormap) copied from the on-screen viewport, when available. */
  properties?: CoreTypes.StackViewportProperties;
  /** Pixel size of the square capture canvas. */
  size?: number;
  onProgress?: (done: number, total: number) => void;
};

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));

/**
 * Renders every image of a series through a single offscreen stack viewport and
 * returns one JPEG data URL per image.
 *
 * A single reused viewport (rather than one per image, and rather than
 * html2canvas per image) keeps a 500-slice CT within reach: annotations are not
 * captured here, so the cornerstone canvas can be read directly.
 */
export default async function captureDisplaySetImages({
  renderingEngine,
  imageIds,
  properties,
  size = 512,
  onProgress,
}: CaptureOptions): Promise<string[]> {
  const element = document.createElement('div');
  element.style.cssText = `position:fixed;top:0;left:-10000px;width:${size}px;height:${size}px;`;
  document.body.appendChild(element);

  const images: string[] = [];

  try {
    renderingEngine.enableElement({
      viewportId: OFFSCREEN_VIEWPORT_ID,
      element,
      type: csEnums.ViewportType.STACK,
      defaultOptions: { background: [0, 0, 0] as [number, number, number] },
    });

    const viewport = renderingEngine.getViewport(OFFSCREEN_VIEWPORT_ID) as StackViewport;

    await viewport.setStack(imageIds);

    if (properties) {
      try {
        viewport.setProperties(properties);
      } catch (error) {
        // A volume viewport's properties do not always apply to a stack viewport;
        // fall back to the series defaults rather than failing the print.
        console.debug('Print: could not inherit viewport properties', error);
      }
    }

    for (let index = 0; index < imageIds.length; index++) {
      await viewport.setImageIdIndex(index);
      viewport.render();
      await nextFrame();

      images.push(viewport.getCanvas().toDataURL('image/jpeg', 0.9));
      onProgress?.(index + 1, imageIds.length);
    }
  } finally {
    try {
      renderingEngine.disableElement(OFFSCREEN_VIEWPORT_ID);
    } catch (error) {
      console.debug('Print: could not disable offscreen viewport', error);
    }
    element.remove();
  }

  return images;
}
