import html2canvas from 'html2canvas';
import { getEnabledElement, StackViewport, BaseVolumeViewport } from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';

/**
 * Maquinaria compartida para rasterizar un viewport a un canvas.
 *
 * Sale del formulario de descarga (CornerstoneViewportDownloadForm), que ya
 * resolvía lo difícil: montar un viewport fuera de pantalla sobre el mismo
 * renderingEngine, re-apilar la imagen activa con sus propiedades y volver a
 * enganchar el toolGroup para que las anotaciones se dibujen. La impresión
 * DICOM necesita exactamente lo mismo, sólo que a resolución de película.
 */

export const MAX_TEXTURE_SIZE = 10000;

/** Monta el viewport fuera de pantalla, clonando el tipo del viewport activo. */
export function enableOffscreenViewport(
  renderingEngine,
  sourceElement: HTMLElement,
  viewportId: string,
  targetElement: HTMLElement
): void {
  if (!targetElement || !sourceElement) {
    return;
  }

  const { viewport } = getEnabledElement(sourceElement);

  renderingEngine.enableElement({
    viewportId,
    element: targetElement,
    type: viewport.type,
    defaultOptions: {
      background: viewport.defaultOptions.background,
      orientation: viewport.defaultOptions.orientation,
    },
  });
}

export function disableOffscreenViewport(renderingEngine, viewportId: string): void {
  renderingEngine.disableElement(viewportId);
}

/** Copia la imagen activa —y su ventana/nivel— al viewport fuera de pantalla. */
export async function loadActiveImage(
  renderingEngine,
  sourceElement: HTMLElement,
  viewportId: string,
  width: number,
  height: number,
  defaultSize: number
): Promise<{ width: number; height: number } | undefined> {
  if (!sourceElement) {
    return undefined;
  }

  const enabledElement = getEnabledElement(sourceElement);
  if (!enabledElement) {
    return undefined;
  }

  const { viewport } = enabledElement;
  const offscreen = renderingEngine.getViewport(viewportId);

  const size = {
    width: Math.min(width || defaultSize, MAX_TEXTURE_SIZE),
    height: Math.min(height || defaultSize, MAX_TEXTURE_SIZE),
  };

  try {
    if (offscreen instanceof StackViewport) {
      await offscreen.setStack([viewport.getCurrentImageId()]);
      offscreen.setProperties(viewport.getProperties());
      return size;
    }

    if (offscreen instanceof BaseVolumeViewport) {
      const volumeIds = viewport.getAllVolumeIds();
      offscreen.setVolumes([{ volumeId: volumeIds[0] }]);
      return size;
    }
  } catch (error) {
    console.error('Error loading image:', error);
  }

  return undefined;
}

/** Engancha el toolGroup del viewport activo para que rendericen las anotaciones. */
export function syncAnnotations(
  renderingEngine,
  sourceElement: HTMLElement,
  viewportId: string,
  show: boolean
): void {
  const enabledElement = getEnabledElement(sourceElement);
  if (!enabledElement) {
    return;
  }

  const offscreen = renderingEngine.getViewport(viewportId);
  if (!offscreen) {
    return;
  }

  const { viewportId: activeViewportId, renderingEngineId } = enabledElement;
  const toolGroup = ToolGroupManager.getToolGroupForViewport(activeViewportId, renderingEngineId);
  toolGroup.addViewport(offscreen.id, renderingEngineId);

  Object.keys(toolGroup.getToolInstances()).forEach(toolName => {
    if (show && toolName !== 'Crosshairs') {
      try {
        toolGroup.setToolEnabled(toolName);
      } catch (error) {
        console.debug('Error enabling tool:', error);
      }
    } else {
      toolGroup.setToolDisabled(toolName);
    }
  });
}

/**
 * Rasteriza el viewport fuera de pantalla.
 *
 * Se usa html2canvas y no `canvas.toDataURL()` a propósito: las anotaciones se
 * dibujan en un overlay SVG encima del canvas de cornerstone, y sólo capturando
 * el div completo salen en la imagen.
 */
export async function rasterizeViewport(viewportId: string): Promise<HTMLCanvasElement | null> {
  const element = document.querySelector(`div[data-viewport-uid="${viewportId}"]`);

  if (!element) {
    console.debug('No viewport found to rasterize');
    return null;
  }

  return html2canvas(element as HTMLElement);
}
