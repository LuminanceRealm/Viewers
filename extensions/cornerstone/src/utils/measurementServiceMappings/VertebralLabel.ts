import SUPPORTED_TOOLS from './constants/supportedTools';
import { getIsLocked } from './utils/getIsLocked';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { getIsVisible } from './utils/getIsVisible';

/**
 * Measurement mapping for the vertebral counting tool. Each annotation is a
 * single point carrying the vertebra name as its text, so the measurement is a
 * POINT whose label is the vertebra.
 */
const VertebralLabel = {
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
      console.warn('VertebralLabel tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;

    if (!SUPPORTED_TOOLS.includes(toolName)) {
      throw new Error('Tool not supported');
    }

    const isLocked = getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, frameNumber } =
      getSOPInstanceAttributes(referencedImageId, displaySetService, annotation);

    const displaySet = SOPInstanceUID
      ? displaySetService.getDisplaySetForSOPInstanceUID(SOPInstanceUID, SeriesInstanceUID)
      : displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    const { points } = data.handles;
    const text = data.text;

    const displayText = getDisplayText(text, displaySet, SOPInstanceUID, frameNumber);
    const getReport = () => _getReport(text, points, FrameOfReferenceUID);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      isLocked,
      isVisible,
      metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      frameNumber: frameNumber || 1,
      toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: text,
      displayText,
      data: data.cachedStats,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};

function getDisplayText(text, displaySet, SOPInstanceUID, frameNumber) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (text) {
    displayText.primary.push(text);
  }

  const instance = displaySet?.instances?.find(image => image.SOPInstanceUID === SOPInstanceUID);
  const instanceText = instance?.InstanceNumber ? ` I: ${instance.InstanceNumber}` : '';
  const frameText = displaySet?.isMultiFrame ? ` F: ${frameNumber}` : '';

  displayText.secondary.push(`S: ${displaySet?.SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}

function _getReport(text, points, FrameOfReferenceUID) {
  const columns = ['AnnotationType', 'Vertebra'];
  const values = ['Cornerstone:VertebralLabel', text];

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

export default VertebralLabel;
