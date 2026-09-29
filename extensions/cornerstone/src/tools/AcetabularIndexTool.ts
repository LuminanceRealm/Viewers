import { getEnabledElement, metaData, utilities as csUtils } from '@cornerstonejs/core';
import {
  CobbAngleTool,
  annotation as csAnnotation,
  drawing,
  utilities as csToolsUtils,
} from '@cornerstonejs/tools';

import { acetabularIndex, columnDirection } from '../utils/orthoGeometry';

const { transformWorldToIndex } = csUtils;
const { getTextBoxCoordsCanvas } = csToolsUtils.drawing;
const {
  drawHandles: drawHandlesSvg,
  drawLine: drawLineSvg,
  drawLinkedTextBox: drawLinkedTextBoxSvg,
} = drawing;
const { getAnnotations } = csAnnotation.state;
const { isAnnotationLocked } = csAnnotation.locking;
const { isAnnotationVisible } = csAnnotation.visibility;

/**
 * NUBIX: coxometría — índice acetabular bilateral.
 *
 * Reutiliza la interacción de CobbAngle (dos segmentos, cuatro puntos):
 *   1–2. Línea de Hilgenreiner: cartílago trirradiado (Y) de un lado y del otro.
 *   3–4. Borde lateral del techo acetabular de cada lado, en cualquier orden.
 *
 * El segundo segmento no se dibuja: en su lugar se trazan, en cada lado, la
 * línea del cartílago al borde (el techo) y la línea de Perkins, perpendicular
 * a Hilgenreiner por el borde lateral, que junto con Hilgenreiner forma los
 * cuadrantes de Ombrédanne. El índice es un ángulo, así que no necesita
 * calibración.
 */
class AcetabularIndexTool extends CobbAngleTool {
  static toolName = 'AcetabularIndex';

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

    // El segundo segmento de CobbAngle (borde a borde) es invisible aquí: sólo
    // la línea de Hilgenreiner selecciona la medición; los bordes se mueven por
    // sus puntos.
    this.isPointNearTool = (element, annotation, canvasCoords, proximity) => {
      const { distanceToPoint } = this.distanceToLines({
        viewport: getEnabledElement(element).viewport,
        points: annotation.data.handles.points,
        canvasCoords,
        proximity,
      });
      return distanceToPoint <= proximity;
    };
  }

  _calculateCachedStats(annotation, renderingEngine, enabledElement) {
    const { data, metadata } = annotation;

    if (data.handles.points.length !== 4) {
      return;
    }

    const { viewport } = enabledElement;
    const { element } = viewport;
    const [yA, yB, edge1, edge2] = data.handles.points;
    const instance = metaData.get('instance', metadata.referencedImageId);
    const columnDir = columnDirection(instance?.PatientOrientation);

    const { cachedStats } = data;
    const targetIds = Object.keys(cachedStats);

    for (let i = 0; i < targetIds.length; i++) {
      const targetId = targetIds[i];
      const image = this.getTargetImageData(targetId);

      if (!image) {
        continue;
      }

      const { imageData } = image;
      const result = acetabularIndex({
        triradiateA: yA,
        triradiateB: yB,
        edge1,
        edge2,
        indexTriradiateA: transformWorldToIndex(imageData, yA),
        indexTriradiateB: transformWorldToIndex(imageData, yB),
        columnDir,
      });

      cachedStats[targetId] = {
        rightAngle: result.right.angle,
        leftAngle: result.left.angle,
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

      const canvas = points.map(p => viewport.worldToCanvas(p));

      if (points.length === 4) {
        if (!data.cachedStats[targetId] || data.cachedStats[targetId].rightAngle == null) {
          data.cachedStats[targetId] = { rightAngle: null };
          this._calculateCachedStats(annotation, renderingEngine, enabledElement);
        } else if (annotation.invalidated) {
          this._throttledCalculateCachedStats(annotation, renderingEngine, enabledElement);
        }
      }

      if (!renderingEngine) {
        console.warn('Rendering Engine has been destroyed');
        return renderStatus;
      }

      if (!isAnnotationVisible(annotationUID)) {
        continue;
      }

      if (!isAnnotationLocked(annotationUID) && !this.editData && activeHandleIndex !== null) {
        drawHandlesSvg(svgDrawingHelper, annotationUID, '0', [canvas[activeHandleIndex]], {
          color,
          lineDash,
          lineWidth,
        });
      }

      const solid = { color, width: lineWidth, lineDash, shadow };
      const guide = { color, width: Math.max(1, lineWidth - 1), lineDash: '4,4', shadow };

      if (canvas.length < 2) {
        continue;
      }

      const [yA, yB] = canvas;
      const edges = canvas.slice(2);
      // Cada borde al cartílago más cercano (en pantalla basta para dibujar).
      const pairs = pairEdges(yA, yB, edges);

      // Hilgenreiner, prolongada lo suficiente para cruzar las líneas de Perkins.
      const h = [yB[0] - yA[0], yB[1] - yA[1]];
      const hLen = Math.hypot(h[0], h[1]) || 1;
      const hHat = [h[0] / hLen, h[1] / hLen];
      const ts = [
        0,
        1,
        ...edges.map(e => ((e[0] - yA[0]) * hHat[0] + (e[1] - yA[1]) * hHat[1]) / hLen),
      ];
      const tMin = Math.min(...ts) - 0.08;
      const tMax = Math.max(...ts) + 0.08;
      const at = t => [yA[0] + h[0] * t, yA[1] + h[1] * t] as [number, number];
      drawLineSvg(svgDrawingHelper, annotationUID, 'hilgenreiner', at(tMin), at(tMax), solid);
      renderStatus = true;

      // Perpendicular en pantalla, apuntando hacia abajo (caudal en una AP).
      let perp = [-hHat[1], hHat[0]];
      if (perp[1] < 0) {
        perp = [-perp[0], -perp[1]];
      }

      pairs.forEach(({ from, edge }, k) => {
        drawLineSvg(svgDrawingHelper, annotationUID, `roof-${k}`, from, edge, solid);
        const top = [edge[0] - perp[0] * hLen * 0.15, edge[1] - perp[1] * hLen * 0.15] as [
          number,
          number,
        ];
        const bottom = [edge[0] + perp[0] * hLen * 0.6, edge[1] + perp[1] * hLen * 0.6] as [
          number,
          number,
        ];
        drawLineSvg(svgDrawingHelper, annotationUID, `perkins-${k}`, top, bottom, guide);
      });

      if (canvas.length < 4) {
        continue;
      }

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
        data.handles.textBox.worldPosition = viewport.canvasToWorld(getTextBoxCoordsCanvas(canvas));
      }

      const textBoxPosition = viewport.worldToCanvas(data.handles.textBox.worldPosition);
      const boundingBox = drawLinkedTextBoxSvg(
        svgDrawingHelper,
        annotationUID,
        'acetabularIndexText',
        textLines,
        textBoxPosition,
        canvas,
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

function pairEdges(yA, yB, edges) {
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (edges.length === 1) {
    const [e] = edges;
    return [{ from: d(e, yA) <= d(e, yB) ? yA : yB, edge: e }];
  }
  if (edges.length === 2) {
    const [e1, e2] = edges;
    const straight = d(e1, yA) + d(e2, yB);
    const crossed = d(e1, yB) + d(e2, yA);
    return straight <= crossed
      ? [
          { from: yA, edge: e1 },
          { from: yB, edge: e2 },
        ]
      : [
          { from: yB, edge: e1 },
          { from: yA, edge: e2 },
        ];
  }
  return [];
}

export function defaultGetTextLines(data, targetId) {
  const stats = data.cachedStats[targetId];
  if (!stats || stats.rightAngle == null || isNaN(stats.rightAngle)) {
    return;
  }
  return [
    'Índice acetabular',
    `D ${stats.rightAngle.toFixed(1)}°`,
    `I ${stats.leftAngle.toFixed(1)}°`,
  ];
}

export default AcetabularIndexTool;
