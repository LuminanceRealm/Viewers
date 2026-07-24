import SUPPORTED_TOOLS from './constants/supportedTools';
import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { utils } from '@ohif/core';

/**
 * Measurement mapping for the cardiothoracic index. The stored value is the
 * ratio between the cardiac and the thoracic diameters; the diameters
 * themselves are only reported when the image has pixel spacing.
 */
const CardiothoracicIndex = {
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
      console.warn('Cardiothoracic index tool: Missing metadata or data');
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

function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { cachedStats } = data;
  const { referencedImageId } = metadata;

  if (!cachedStats || !Object.keys(cachedStats).length) {
    return;
  }

  const annotations = [];

  Object.keys(cachedStats).forEach(targetId => {
    const { ratio, cardiacDiameter, thoracicDiameter, unit } = cachedStats[targetId];

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
      ratio,
      cardiacDiameter,
      thoracicDiameter,
      unit,
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

  const { ratio, cardiacDiameter, thoracicDiameter, unit, SeriesNumber, SOPInstanceUID, frameNumber } =
    mappedAnnotations[0];

  if (ratio === undefined || ratio === null) {
    return displayText;
  }

  displayText.primary.push(`ICT ${utils.roundNumber(ratio, 2)}`);

  if (unit && unit !== 'px') {
    displayText.primary.push(
      `C ${utils.roundNumber(cardiacDiameter, 1)} / T ${utils.roundNumber(thoracicDiameter, 1)} ${unit}`
    );
  }

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);
  const instanceText = instance?.InstanceNumber ? ` I: ${instance.InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}

function _getReport(mappedAnnotations, points, FrameOfReferenceUID) {
  const columns = ['AnnotationType'];
  const values = ['Cornerstone:CardiothoracicIndex'];

  mappedAnnotations?.forEach(({ ratio, cardiacDiameter, thoracicDiameter, unit }) => {
    columns.push('CardiothoracicIndex');
    values.push(ratio);
    columns.push(`CardiacDiameter (${unit})`);
    values.push(cardiacDiameter);
    columns.push(`ThoracicDiameter (${unit})`);
    values.push(thoracicDiameter);
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

export default CardiothoracicIndex;
