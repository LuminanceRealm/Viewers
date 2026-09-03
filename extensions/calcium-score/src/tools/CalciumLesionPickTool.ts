import { BaseVolumeViewport, getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';
import { BaseTool, segmentation as csToolsSegmentation } from '@cornerstonejs/tools';

import { CANDIDATE_INDEX, TOOL_NAME } from '../constants';
import { collectComponent3D } from '../utils/floodFill3D';
import { buildSliceStack, findCalciumSegmentationForViewport } from '../utils/labelmapAccess';

const { triggerSegmentationDataModified } = csToolsSegmentation.triggerSegmentationEvents;

/**
 * Asigna calcificaciones a arterias con un clic.
 *
 * El labelmap ya trae marcado como "candidato" todo lo que pasa de 130 HU. Un
 * clic sobre una calcificación toma toda su componente conexa en 3D y la pasa al
 * segmento activo (la arteria elegida en el panel). Un clic sobre una lesión que
 * ya pertenece a la arteria activa la devuelve a candidato; sobre una de otra
 * arteria, la reasigna. Con el segmento "candidatos" activo el clic sólo quita.
 *
 * Sólo opera en viewports stack: es donde vive la serie original y donde el
 * labelmap derivado tiene un corte por imagen.
 */
class CalciumLesionPickTool extends BaseTool {
  static toolName = TOOL_NAME;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        /** Se llama con un mensaje cuando el clic no puede aplicarse. */
        onRejected: undefined as ((reason: string) => void) | undefined,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  private reject(reason: string): boolean {
    const { onRejected } = this.configuration;
    if (typeof onRejected === 'function') {
      onRejected(reason);
    }
    return true;
  }

  preMouseDownCallback = (evt): boolean => {
    const { element, currentPoints } = evt.detail;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) {
      return false;
    }
    const { viewport } = enabledElement;

    if (viewport instanceof BaseVolumeViewport) {
      return this.reject('El score de calcio se asigna en la vista 2D de la serie, no en MPR.');
    }

    const refs = findCalciumSegmentationForViewport(viewport.id);
    if (!refs) {
      return this.reject('Primero inicia el score de calcio en esta serie desde el panel.');
    }

    const imageId = (viewport as { getCurrentImageId?: () => string }).getCurrentImageId?.();
    const k = imageId ? refs.referencedImageIds.indexOf(imageId) : -1;
    if (k < 0) {
      return this.reject('La imagen mostrada no pertenece a la serie del score.');
    }

    const imageCoords = csUtils.worldToImageCoords(imageId, currentPoints.world);
    if (!imageCoords) {
      return false;
    }

    const stack = buildSliceStack(refs);
    // La posición del paciente apunta al centro del primer píxel: redondear.
    const i = Math.round(imageCoords[0]);
    const j = Math.round(imageCoords[1]);
    if (i < 0 || j < 0 || i >= stack.width || j >= stack.height) {
      return false;
    }

    const idx = j * stack.width + i;
    const clicked = stack.labels[k][idx];
    if (clicked === 0) {
      return this.reject('Ahí no hay calcificación (< 130 HU).');
    }

    const active = csToolsSegmentation.segmentIndex.getActiveSegmentIndex(refs.segmentationId);
    const target = clicked === active ? CANDIDATE_INDEX : active;
    if (target === clicked) {
      return true;
    }

    const grid = {
      width: stack.width,
      height: stack.height,
      depth: stack.depth,
      get: (kk: number, ii: number) => stack.labels[kk][ii],
    };
    const component = collectComponent3D(grid, k, idx, v => v === clicked);

    component.forEach(({ k: kk, indices }) => {
      const labels = stack.labels[kk];
      for (let n = 0; n < indices.length; n++) {
        labels[indices[n]] = target;
      }
    });

    triggerSegmentationDataModified(
      refs.segmentationId,
      component.map(c => c.k)
    );

    return true;
  };
}

export default CalciumLesionPickTool;
