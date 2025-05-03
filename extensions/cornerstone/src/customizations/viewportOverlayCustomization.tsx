export default {
  'viewportOverlay.topLeft': [
    {
      id: 'PatientId',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient ID',
      condition: ({ referenceInstance }) => !!referenceInstance?.PatientID,
      contentF: ({ referenceInstance }) => referenceInstance.PatientID,
    },
    {
      id: 'PatientName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient name',
      condition: ({ referenceInstance }) => !!referenceInstance?.PatientName,
      contentF: ({ referenceInstance }) => referenceInstance.PatientName,
    },
    {
      id: 'PatientSexAndAge',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Sex, age & DOB',
      condition: ({ referenceInstance }) =>
        !!(referenceInstance?.PatientSex && referenceInstance?.PatientAge),
      contentF: ({ referenceInstance, formatters: { formatDate } }) => {
        const parts = [`${referenceInstance.PatientAge} ${referenceInstance.PatientSex}`];
        if (referenceInstance.PatientBirthDate) {
          parts[0] += ` (${formatDate(referenceInstance.PatientBirthDate)})`;
        }
        return parts[0];
      },
    },
  ],

  'viewportOverlay.topRight': [
    {
      id: 'InstitutionName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Gabinete',
      condition: ({ referenceInstance }) => !!referenceInstance?.InstitutionName,
      contentF: ({ referenceInstance }) => referenceInstance.InstitutionName,
    },
    {
      id: 'StudyDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Study date',
      condition: ({ referenceInstance }) =>
        !!(referenceInstance?.StudyDate && referenceInstance?.StudyTime),
      contentF: ({ referenceInstance, formatters: { formatDate, formatTime } }) =>
        `${formatDate(referenceInstance.StudyDate)} ${formatTime(referenceInstance.StudyTime)}`,
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Series description',
      condition: ({ referenceInstance }) => !!referenceInstance?.SeriesDescription,
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
      condition: props =>
        props.toolGroupService.getActiveToolForViewport(props.viewportId) === 'Zoom',
    },
    {
      id: 'ImagePositionPatient',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Posición',
      condition: ({ referenceInstance }) =>
        Array.isArray(referenceInstance?.ImagePositionPatient) &&
        referenceInstance.ImagePositionPatient.length > 0,
      contentF: ({ referenceInstance }) => {
        const positions = referenceInstance.ImagePositionPatient.map(val =>
          typeof val === 'number' ? val.toFixed(2) : val
        );
        return `Pos: ${positions.join(', ')}`;
      },
    },
    {
      id: 'ImageLaterality',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Lateralidad',
      condition: ({ referenceInstance }) => !!referenceInstance?.ImageLaterality,
      contentF: ({ referenceInstance }) => referenceInstance.ImageLaterality,
    },
    {
      id: 'ManufacturerModelName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Equipo',
      condition: ({ referenceInstance }) => !!referenceInstance?.ManufacturerModelName,
      contentF: ({ referenceInstance }) => referenceInstance.ManufacturerModelName,
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
      title: 'Slice thickness',
      condition: ({ referenceInstance }) => !!referenceInstance?.SliceThickness,
      contentF: ({ referenceInstance }) => `Grosor: ${referenceInstance.SliceThickness} mm`,
    },
    {
      id: 'ExposureParams',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Exposición',
      condition: ({ referenceInstance }) =>
        !!(
          referenceInstance?.KVP ||
          referenceInstance?.XRayTubeCurrent ||
          referenceInstance?.Exposure
        ),
      contentF: ({ referenceInstance }) => {
        const parts = [];
        if (referenceInstance.KVP) {
          parts.push(`${referenceInstance.KVP} kV`);
        }
        if (referenceInstance.XRayTubeCurrent) {
          parts.push(`${referenceInstance.XRayTubeCurrent} mA`);
        }
        if (referenceInstance.Exposure) {
          parts.push(`${referenceInstance.Exposure} mAs`);
        }
        return parts.join(' ');
      },
    },
    {
      id: 'MRParams',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'RM',
      condition: ({ referenceInstance }) =>
        !!(
          referenceInstance?.RepetitionTime ||
          referenceInstance?.EchoTime ||
          referenceInstance?.InversionTime ||
          referenceInstance?.AcquisitionTime
        ),
      contentF: ({ referenceInstance, formatters: { formatTime } }) => {
        const parts = [];
        if (referenceInstance.RepetitionTime) {
          parts.push(`TR:${referenceInstance.RepetitionTime}ms`);
        }
        if (referenceInstance.EchoTime) {
          parts.push(`TE:${referenceInstance.EchoTime}ms`);
        }
        if (referenceInstance.InversionTime) {
          parts.push(`TI:${referenceInstance.InversionTime}ms`);
        }
        return parts.join(' ');
      },
    },
  ],
};
