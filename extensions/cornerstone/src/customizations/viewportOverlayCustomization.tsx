export default {
  'viewportOverlay.topLeft': [
    {
      id: 'PatientId',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient ID',
      condition: ({ referenceInstance }) => referenceInstance?.PatientID,
      contentF: ({ referenceInstance }) => referenceInstance.PatientID,
    },
    {
      id: 'PatientName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient name',
      condition: ({ referenceInstance }) => referenceInstance?.PatientName,
      contentF: ({ referenceInstance }) => referenceInstance.PatientName,
    },
    {
      id: 'PatientSexAndAge',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient name',
      condition: ({ referenceInstance }) => referenceInstance?.PatientSex,
      contentF: ({ referenceInstance }) =>
        `${referenceInstance.PatientAge} ${referenceInstance.PatientSex}`,
    },
  ],
  'viewportOverlay.topRight': [
    {
      id: 'StudyDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Study date',
      condition: ({ referenceInstance }) => referenceInstance?.StudyDate,
      contentF: ({ referenceInstance, formatters: { formatDate, formatTime } }) =>
        `${formatDate(referenceInstance.StudyDate)} ${formatTime(referenceInstance.StudyTime)}`,
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Series description',
      condition: ({ referenceInstance }) => {
        return referenceInstance && referenceInstance.SeriesDescription;
      },
      contentF: ({ referenceInstance }) => referenceInstance.SeriesDescription,
    },
  ],
  'viewportOverlay.bottomLeft': [
    {
      id: 'WindowLevel',
      inheritsFrom: 'ohif.overlayItem.windowLevel',
    },
    {
      id: 'ZoomLevel',
      inheritsFrom: 'ohif.overlayItem.zoomLevel',
      condition: props => {
        const activeToolName = props.toolGroupService.getActiveToolForViewport(props.viewportId);
        return activeToolName === 'Zoom';
      },
    },
  ],
  'viewportOverlay.bottomRight': [
    {
      id: 'InstanceNumber',
      inheritsFrom: 'ohif.overlayItem.instanceNumber',
    },
    {
      id: 'SliceThickness',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'SliceThickness',
      condition: ({ referenceInstance }) => referenceInstance?.SliceThickness,
      contentF: ({ referenceInstance }) => `Grosor: ${referenceInstance.SliceThickness} mm`,
    },
  ],
};
