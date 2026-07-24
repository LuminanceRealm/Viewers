import { utilities as csUtils } from '@cornerstonejs/core';
import {
  CobbAngleTool,
  annotation as csAnnotation,
  drawing,
  utilities as csToolsUtils,
} from '@cornerstonejs/tools';

const { transformWorldToIndex, roundNumber } = csUtils;
const { getCalibratedLengthUnitsAndScale } = csToolsUtils;
const { getTextBoxCoordsCanvas } = csToolsUtils.drawing;
const {
  drawHandles: drawHandlesSvg,
  drawLine: drawLineSvg,
  drawLinkedTextBox: drawLinkedTextBoxSvg,
} = drawing;
const { getAnnotations } = csAnnotation.state;
const { isAnnotationLocked } = csAnnotation.locking;
const { isAnnotationVisible } = csAnnotation.visibility;

/** Upper limit of normality for the cardiothoracic ratio on a PA chest film. */
export const CTI_NORMAL_LIMIT = 0.5;

/**
 * Cardiothoracic index (índice cardiotorácico).
 *
 * Reuses the CobbAngle interaction — two independent segments, four handles —
 * but instead of the angle between them it reports the ratio between their
 * lengths: the first segment is the maximum transverse cardiac diameter, the
 * second one the maximum internal thoracic diameter.
 *
 * Being a ratio it is unit-free, so it stays valid on studies without reliable
 * pixel spacing; the individual diameters are only shown when the image is
 * calibrated.
 */
class CardiothoracicIndexTool extends CobbAngleTool {
  static toolName = 'CardiothoracicIndex';

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
        getTextLines: defaultGetTextLines,
        showArcLines: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  _calculateCachedStats(annotation, renderingEngine, enabledElement) {
    const { data } = annotation;

    if (data.handles.points.length !== 4) {
      return;
    }

    const { viewport } = enabledElement;
    const { element } = viewport;
    const [cardiac1, cardiac2, thoracic1, thoracic2] = data.handles.points;

    const { cachedStats } = data;
    const targetIds = Object.keys(cachedStats);

    for (let i = 0; i < targetIds.length; i++) {
      const targetId = targetIds[i];
      const image = this.getTargetImageData(targetId);

      if (!image) {
        continue;
      }

      const { imageData } = image;
      const toIndex = point => transformWorldToIndex(imageData, point);

      // Both diameters are divided by the same scale, so the ratio is the same
      // whether or not the image carries pixel spacing.
      const { scale: cardiacScale, unit } = getCalibratedLengthUnitsAndScale(image, [
        toIndex(cardiac1),
        toIndex(cardiac2),
      ]);
      const { scale: thoracicScale } = getCalibratedLengthUnitsAndScale(image, [
        toIndex(thoracic1),
        toIndex(thoracic2),
      ]);

      const cardiacDiameter = distance(cardiac1, cardiac2) / cardiacScale;
      const thoracicDiameter = distance(thoracic1, thoracic2) / thoracicScale;

      cachedStats[targetId] = {
        cardiacDiameter,
        thoracicDiameter,
        ratio: thoracicDiameter ? cardiacDiameter / thoracicDiameter : null,
        unit,
      };
    }

    annotation.invalidated = false;
    csAnnotation.state.triggerAnnotationModified(annotation, element);

    return cachedStats;
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;

    let annotations = getAnnotations(this.getToolName(), element);

    if (!annotations?.length) {
      return renderStatus;
    }

    annotations = this.filterInteractableAnnotationsForElement(element, annotations);

    if (!annotations?.length) {
      return renderStatus;
    }

    const targetId = this.getTargetId(viewport);
    const renderingEngine = viewport.getRenderingEngine();

    const styleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: viewport.id,
      annotationUID: undefined,
    };

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i];
      const { annotationUID, data } = annotation;
      const { points, activeHandleIndex } = data.handles;

      styleSpecifier.annotationUID = annotationUID;

      const { color, lineWidth, lineDash, shadow } = this.getAnnotationStyle({
        annotation,
        styleSpecifier,
      });

      const canvasCoordinates = points.map(p => viewport.worldToCanvas(p));

      if (!data.cachedStats[targetId] || data.cachedStats[targetId].ratio == null) {
        data.cachedStats[targetId] = { ratio: null };
        this._calculateCachedStats(annotation, renderingEngine, enabledElement);
      } else if (annotation.invalidated) {
        this._throttledCalculateCachedStats(annotation, renderingEngine, enabledElement);
      }

      if (!renderingEngine) {
        console.warn('Rendering Engine has been destroyed');
        return renderStatus;
      }

      if (!isAnnotationVisible(annotationUID)) {
        continue;
      }

      if (!isAnnotationLocked(annotationUID) && !this.editData && activeHandleIndex !== null) {
        drawHandlesSvg(svgDrawingHelper, annotationUID, '0', [canvasCoordinates[activeHandleIndex]], {
          color,
          lineDash,
          lineWidth,
        });
      }

      drawLineSvg(
        svgDrawingHelper,
        annotationUID,
        'cardiacLine',
        canvasCoordinates[0],
        canvasCoordinates[1],
        { color, width: lineWidth, lineDash, shadow }
      );

      renderStatus = true;

      // The thoracic segment does not exist until the second line is started.
      if (canvasCoordinates.length < 4) {
        continue;
      }

      drawLineSvg(
        svgDrawingHelper,
        annotationUID,
        'thoracicLine',
        canvasCoordinates[2],
        canvasCoordinates[3],
        { color, width: lineWidth, lineDash, shadow }
      );

      const options = this.getLinkedTextBoxStyle(styleSpecifier, annotation);

      if (!options.visibility) {
        data.handles.textBox = {
          hasMoved: false,
          worldPosition: [0, 0, 0],
          worldBoundingBox: {
            topLeft: [0, 0, 0],
            topRight: [0, 0, 0],
            bottomLeft: [0, 0, 0],
            bottomRight: [0, 0, 0],
          },
        };
        continue;
      }

      const textLines = this.configuration.getTextLines(data, targetId);

      if (!textLines?.length) {
        continue;
      }

      if (!data.handles.textBox.hasMoved) {
        data.handles.textBox.worldPosition = viewport.canvasToWorld(
          getTextBoxCoordsCanvas(canvasCoordinates)
        );
      }

      const textBoxPosition = viewport.worldToCanvas(data.handles.textBox.worldPosition);

      const boundingBox = drawLinkedTextBoxSvg(
        svgDrawingHelper,
        annotationUID,
        'cardiothoracicIndexText',
        textLines,
        textBoxPosition,
        canvasCoordinates,
        {},
        options
      );

      const { x: left, y: top, width, height } = boundingBox;

      data.handles.textBox.worldBoundingBox = {
        topLeft: viewport.canvasToWorld([left, top]),
        topRight: viewport.canvasToWorld([left + width, top]),
        bottomLeft: viewport.canvasToWorld([left, top + height]),
        bottomRight: viewport.canvasToWorld([left + width, top + height]),
      };
    }

    return renderStatus;
  };
}

function distance(point1, point2) {
  const dx = point1[0] - point2[0];
  const dy = point1[1] - point2[1];
  const dz = point1[2] - point2[2];

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function defaultGetTextLines(data, targetId) {
  const stats = data.cachedStats[targetId];

  if (!stats || stats.ratio == null || isNaN(stats.ratio)) {
    return;
  }

  const { cardiacDiameter, thoracicDiameter, ratio, unit } = stats;
  const textLines = [`ICT ${ratio.toFixed(2)}`];

  // Without pixel spacing the diameters are in pixels and say nothing on their
  // own — only the ratio is meaningful, so they are left out.
  if (unit && unit !== 'px') {
    textLines.push(`Cardíaco ${roundNumber(cardiacDiameter)} ${unit}`);
    textLines.push(`Torácico ${roundNumber(thoracicDiameter)} ${unit}`);
  }

  return textLines;
}

export default CardiothoracicIndexTool;
