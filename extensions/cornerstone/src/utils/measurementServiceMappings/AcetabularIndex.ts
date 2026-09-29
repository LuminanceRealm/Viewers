import SUPPORTED_TOOLS from './constants/supportedTools';
import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';

/**
 * NUBIX: mapeo de la coxometría (índice acetabular bilateral). Guarda el
 * ángulo de cada lado del paciente; es un ángulo, así que no depende de la
 * calibración.
 */
const AcetabularIndex = {
  toAnnotation: measurement => {},

  toMeasurement: (
    csToolsEventDetail,
    displaySetService,
    cornerstoneViewportService,
    getValueTypeFromToolType,
    customizationService
  ) => {
    const { annotation } = csToolsEventDetail;
    const { metadata, data, annotationUID } = annotation;

    if (!metadata || !data) {
      console.warn('Acetabular index tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;

    if (!SUPPORTED_TOOLS.includes(toolName)) {
      throw new Error('Tool not supported');
    }

    const isLocked = getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = SOPInstanceUID
      ? displaySetService.getDisplaySetForSOPInstanceUID(SOPInstanceUID, SeriesInstanceUID)
      : displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    const { points, textBox } = data.handles;

    const mappedAnnotations = getMappedAnnotations(annotation, displaySetService);
    const displayText = getDisplayText(mappedAnnotations, displaySet);
    const getReport = () => _getReport(mappedAnnotations, points, FrameOfReferenceUID);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      textBox,
      isLocked,
      isVisible,
      metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      frameNumber: mappedAnnotations?.[0]?.frameNumber || 1,
      toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: data.label,
      displayText,
      data: data.cachedStats,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};

/** Un decimal fijo: `utils.roundNumber(x, 1)` de @ohif/core lanza con ángulos de dos cifras. */
function fmt(value: number): string {
  return Number(value).toFixed(1);
}

function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { cachedStats } = data;
  const { referencedImageId } = metadata;

  if (!cachedStats || !Object.keys(cachedStats).length) {
    return;
  }

  const annotations = [];

  Object.keys(cachedStats).forEach(targetId => {
    const stats = cachedStats[targetId];

    const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    annotations.push({
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber: displaySet.SeriesNumber,
      frameNumber,
      rightAngle: stats.rightAngle,
      leftAngle: stats.leftAngle,
    });
  });

  return annotations;
}

function getDisplayText(mappedAnnotations, displaySet) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (!mappedAnnotations?.length) {
    return displayText;
  }

  const first = mappedAnnotations[0];
  const { SeriesNumber, SOPInstanceUID, frameNumber } = first;

  if (first.rightAngle == null || first.leftAngle == null) {
    return displayText;
  }

  displayText.primary.push(`IA D ${fmt(first.rightAngle)}° · I ${fmt(first.leftAngle)}°`);

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);
  const instanceText = instance?.InstanceNumber ? ` I: ${instance.InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}

function _getReport(mappedAnnotations, points, FrameOfReferenceUID) {
  const columns = ['AnnotationType'];
  const values = ['Cornerstone:AcetabularIndex'];

  mappedAnnotations?.forEach(({ rightAngle, leftAngle }) => {
    columns.push('AcetabularIndexRight (deg)');
    values.push(rightAngle);
    columns.push('AcetabularIndexLeft (deg)');
    values.push(leftAngle);
  });

  if (FrameOfReferenceUID) {
    columns.push('FrameOfReferenceUID');
    values.push(FrameOfReferenceUID);
  }

  if (points) {
    columns.push('points');
    values.push(points.map(p => p.join(' ')).join(';'));
  }

  return { columns, values };
}

export default AcetabularIndex;
