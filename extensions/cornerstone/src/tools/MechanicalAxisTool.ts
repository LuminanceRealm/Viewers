import { metaData, utilities as csUtils } from '@cornerstonejs/core';
import {
  AngleTool,
  annotation as csAnnotation,
  drawing,
  utilities as csToolsUtils,
} from '@cornerstonejs/tools';

import { columnDirection, mechanicalAxis, NEUTRAL_TOLERANCE_DEG } from '../utils/orthoGeometry';

const { transformWorldToIndex } = csUtils;
const { getCalibratedLengthUnitsAndScale } = csToolsUtils;
const { drawLine: drawLineSvg } = drawing;
const { getAnnotations } = csAnnotation.state;
const { isAnnotationVisible } = csAnnotation.visibility;

/** Desviación que se considera dentro de lo normal a cada lado de 180°. */
export const HKA_NORMAL_LIMIT_DEG = 3;

/**
 * NUBIX: gonometría — eje mecánico femorotibial (ángulo HKA).
 *
 * Reutiliza la interacción de Angle (tres puntos, vértice en el segundo):
 *   1. Centro de la cabeza femoral.
 *   2. Centro de la rodilla (vértice).
 *   3. Centro del tobillo.
 *
 * Además de los ejes mecánicos del fémur y la tibia dibuja, discontinua, la
 * línea cadera-tobillo (Mikulicz). Informa el HKA, varo o valgo y la
 * desviación del eje mecánico en la rodilla (DEM) cuando la imagen está
 * calibrada. Se usa en la telerradiografía de miembros inferiores en carga,
 * una medición por miembro.
 */
class MechanicalAxisTool extends AngleTool {
  static toolName = 'MechanicalAxis';

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
        getTextLines: defaultGetTextLines,
      },
    }
  ) {
    super(toolProps, defaultToolProps);

    // AngleTool asigna renderAnnotation en su constructor; se envuelve para
    // añadir la línea de Mikulicz sin copiar el resto del dibujo.
    const baseRender = this.renderAnnotation;
    this.renderAnnotation = (enabledElement, svgDrawingHelper) => {
      const status = baseRender(enabledElement, svgDrawingHelper);
      this._drawMikulicz(enabledElement, svgDrawingHelper);
      return status;
    };
  }

  _drawMikulicz(enabledElement, svgDrawingHelper) {
    const { viewport } = enabledElement;
    const { element } = viewport;

    let annotations = getAnnotations(this.getToolName(), element);
    if (!annotations?.length) {
      return;
    }
    annotations = this.filterInteractableAnnotationsForElement(element, annotations);

    annotations?.forEach(annotation => {
      const { annotationUID, data } = annotation;
      if (data.handles.points.length !== 3 || !isAnnotationVisible(annotationUID)) {
        return;
      }
      const { color, lineWidth } = this.getAnnotationStyle({
        annotation,
        styleSpecifier: {
          toolGroupId: this.toolGroupId,
          toolName: this.getToolName(),
          viewportId: viewport.id,
          annotationUID,
        },
      });
      const [hip, , ankle] = data.handles.points.map(p => viewport.worldToCanvas(p));
      drawLineSvg(svgDrawingHelper, annotationUID, 'mikulicz', hip, ankle, {
        color,
        width: Math.max(1, lineWidth - 1),
        lineDash: '6,4',
      });
    });
  }

  _calculateCachedStats(annotation, renderingEngine, enabledElement) {
    const { data, metadata } = annotation;
    const { element } = enabledElement.viewport;

    if (data.handles.points.length !== 3) {
      return;
    }

    const [hip, knee, ankle] = data.handles.points;
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

      const { imageData, dimensions } = image;
      const toIndex = p => transformWorldToIndex(imageData, p);
      const indexHip = toIndex(hip);
      const indexKnee = toIndex(knee);
      const indexAnkle = toIndex(ankle);

      const result = mechanicalAxis({
        hip,
        knee,
        ankle,
        indexHip,
        indexKnee,
        indexAnkle,
        imageColumns: dimensions[0],
        columnDir,
      });

      // Misma escala que usa la regla, para que la DEM salga en mm cuando se puede.
      const { scale, unit } = getCalibratedLengthUnitsAndScale(image, [indexHip, indexAnkle]);

      cachedStats[targetId] = {
        // `angle` lo lee el dibujo de AngleTool para decidir si hay texto.
        angle: result.hka,
        hka: result.hka,
        deviation: result.deviation,
        alignment: result.alignment,
        side: result.side,
        mad: result.mad / scale,
        unit,
      };
    }

    annotation.invalidated = false;
    csAnnotation.state.triggerAnnotationModified(annotation, element);

    return cachedStats;
  }
}

const SIDE_LABEL = { R: 'D', L: 'I' };

export function alignmentLabel(stats): string {
  const { alignment, deviation } = stats;
  if (alignment === 'neutral' || deviation < NEUTRAL_TOLERANCE_DEG) {
    return 'Eje neutro';
  }
  const amount = `${deviation.toFixed(1)}°`;
  if (alignment === 'varus') {
    return `Varo ${amount}`;
  }
  if (alignment === 'valgus') {
    return `Valgo ${amount}`;
  }
  return `Desvío ${amount} (lado no determinable)`;
}

export function defaultGetTextLines(data, targetId) {
  const stats = data.cachedStats[targetId];
  if (!stats || stats.hka == null || isNaN(stats.hka)) {
    return;
  }
  const side = stats.side ? ` ${SIDE_LABEL[stats.side]}` : '';
  const lines = [`HKA${side} ${stats.hka.toFixed(1)}°`, alignmentLabel(stats)];
  // Sin espaciado de píxel la distancia no dice nada: sólo se muestra calibrada.
  if (stats.unit && stats.unit !== 'px' && stats.deviation >= NEUTRAL_TOLERANCE_DEG) {
    lines.push(`DEM ${stats.mad.toFixed(1)} ${stats.unit}`);
  }
  return lines;
}

export default MechanicalAxisTool;
