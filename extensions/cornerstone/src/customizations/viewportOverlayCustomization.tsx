export default {
  'viewportOverlay.topLeft': [
    {
      id: 'PatientId',
      inheritsFrom: 'ohif.overlayItem',
      label: 'ID: ',
      title: 'Patient ID',
      condition: ({ referenceInstance }) => !!referenceInstance?.PatientID,
      contentF: ({ referenceInstance }) => referenceInstance.PatientID,
    },
    {
      id: 'PatientName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient',
      condition: ({ referenceInstance }) => !!referenceInstance?.PatientName,
      contentF: ({ referenceInstance }) => referenceInstance.PatientName,
    },
    {
      id: 'PatientSexAndAge',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Sex/Age/DOB',
      condition: ({ referenceInstance }) =>
        !!(referenceInstance?.PatientSex && referenceInstance?.PatientAge),
      contentF: ({ referenceInstance, formatters: { formatDate } }) => {
        let text = `${referenceInstance.PatientSex} ${referenceInstance.PatientAge}`;
        const dob = referenceInstance.PatientBirthDate;
        if (dob) {
          const d = formatDate(dob);
          if (d && d.toLowerCase() !== 'invalid date') {
            text += ` (${d})`;
          }
        }
        return text;
      },
    },
    {
      id: 'InstitutionName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Institution',
      condition: ({ referenceInstance }) => !!referenceInstance?.InstitutionName,
      contentF: ({ referenceInstance }) => referenceInstance.InstitutionName,
    },
  ],

  'viewportOverlay.topRight': [
    {
      id: 'StudyDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Date/Time',
      condition: ({ referenceInstance }) =>
        !!(referenceInstance?.StudyDate && referenceInstance?.StudyTime),
      contentF: ({ referenceInstance, formatters: { formatDate, formatTime } }) =>
        `${formatDate(referenceInstance.StudyDate)} ${formatTime(referenceInstance.StudyTime)}`,
    },
    {
      id: 'StudyDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: 'ST: ',
      title: 'Study',
      condition: ({ referenceInstance }) => !!referenceInstance?.StudyDescription,
      contentF: ({ referenceInstance }) => referenceInstance.StudyDescription,
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: 'SE: ',
      title: 'Series',
      condition: ({ referenceInstance }) => !!referenceInstance?.SeriesDescription,
      contentF: ({ referenceInstance }) => referenceInstance.SeriesDescription,
    },
    {
      id: 'SequenceName',
      inheritsFrom: 'ohif.overlayItem',
      label: 'SQ: ',
      title: 'Sequence',
      condition: ({ referenceInstance }) => !!referenceInstance?.SequenceName,
      contentF: ({ referenceInstance }) => referenceInstance.SequenceName,
    },
  ],

  'viewportOverlay.bottomLeft': [
    {
      id: 'WindowLevel',
      inheritsFrom: 'ohif.overlayItem.windowLevel',
      label: '',
    },
    {
      id: 'ZoomLevel',
      inheritsFrom: 'ohif.overlayItem.zoomLevel',
      label: '',
      condition: props =>
        props.toolGroupService.getActiveToolForViewport(props.viewportId) === 'Zoom',
    },
    {
      id: 'SeqParams',
      inheritsFrom: 'ohif.overlayItem',
      label: 'SEQ: ',
      title: 'Seq Params',
      condition: ({ referenceInstance }) =>
        !!(
          referenceInstance?.PixelBandwidth ||
          referenceInstance?.MagnificationFactor ||
          referenceInstance?.ReceiveCoilName
        ),
      contentF: ({ referenceInstance }) => {
        const parts = [];
        if (referenceInstance.PixelBandwidth) {
          parts.push(`BW:${referenceInstance.PixelBandwidth}`);
        }
        if (referenceInstance.MagnificationFactor) {
          parts.push(`MF:${referenceInstance.MagnificationFactor.toFixed(2)}`);
        }
        if (referenceInstance.ReceiveCoilName) {
          parts.push(referenceInstance.ReceiveCoilName);
        }
        return parts.join(' ');
      },
    },
    {
      id: 'PatientOrientation',
      inheritsFrom: 'ohif.overlayItem',
      label: 'ORI: ',
      title: 'Orientation',
      condition: ({ referenceInstance }) => Array.isArray(referenceInstance?.PatientOrientation),
      contentF: ({ referenceInstance }) => referenceInstance.PatientOrientation.join('>'),
    },
    {
      id: 'Pos',
      inheritsFrom: 'ohif.overlayItem',
      label: 'POS: ',
      title: 'Position',
      condition: ({ referenceInstance }) =>
        Array.isArray(referenceInstance?.ImagePositionPatient) &&
        referenceInstance.ImagePositionPatient.length > 0,
      contentF: ({ referenceInstance }) =>
        referenceInstance.ImagePositionPatient.map(v =>
          typeof v === 'number' ? v.toFixed(2) : v
        ).join(', '),
    },
    {
      id: 'Lat',
      inheritsFrom: 'ohif.overlayItem',
      label: 'LAT: ',
      title: 'Laterality',
      condition: ({ referenceInstance }) => !!referenceInstance?.ImageLaterality,
      contentF: ({ referenceInstance }) =>
        referenceInstance.ImageLaterality.toUpperCase() === 'L'
          ? '←'
          : referenceInstance.ImageLaterality.toUpperCase() === 'R'
            ? '→'
            : referenceInstance.ImageLaterality,
    },
    {
      id: 'Device',
      inheritsFrom: 'ohif.overlayItem',
      label: 'DEV: ',
      title: 'Device',
      condition: ({ referenceInstance }) => !!referenceInstance?.ManufacturerModelName,
      contentF: ({ referenceInstance }) => referenceInstance.ManufacturerModelName,
    },
  ],

  'viewportOverlay.bottomRight': [
    {
      id: 'InstanceNumber',
      inheritsFrom: 'ohif.overlayItem.instanceNumber',
      label: 'IN: ',
    },
    {
      id: 'SliceThickness',
      inheritsFrom: 'ohif.overlayItem',
      label: 'TH: ',
      title: 'Thickness',
      condition: ({ referenceInstance }) => !!referenceInstance?.SliceThickness,
      contentF: ({ referenceInstance }) => `${referenceInstance.SliceThickness}mm`,
    },
    {
      id: 'Calc',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Calculated',
      condition: ({ referenceInstance }) =>
        (!!referenceInstance?.PixelSpacing &&
          referenceInstance?.Columns &&
          referenceInstance?.Rows) ||
        !!referenceInstance?.NumberOfFrames,
      contentF: ({ referenceInstance }) => {
        const parts = [];
        const ps = referenceInstance.PixelSpacing;
        const { Columns: cols, Rows: rows, NumberOfFrames: frames } = referenceInstance;
        if (ps && cols && rows) {
          const fovX = (ps[0] * cols).toFixed(1);
          const fovY = (ps[1] * rows).toFixed(1);
          parts.push(`FoV:${fovX}×${fovY}mm`);
        }
        if (frames) {
          parts.push(`Frames:${frames}`);
        }
        return parts.join(' ');
      },
    },
    {
      id: 'Exp',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Exposure',
      condition: ({ referenceInstance }) =>
        !!(
          referenceInstance?.KVP ||
          referenceInstance?.XRayTubeCurrent ||
          referenceInstance?.Exposure
        ),
      contentF: ({ referenceInstance }) => {
        const parts = [];
        if (referenceInstance.KVP) {
          parts.push(`${referenceInstance.KVP}kV`);
        }
        if (referenceInstance.XRayTubeCurrent) {
          parts.push(`${referenceInstance.XRayTubeCurrent}mA`);
        }
        if (referenceInstance.Exposure) {
          parts.push(`${referenceInstance.Exposure}mAs`);
        }
        return parts.join(' ');
      },
    },
    {
      id: 'RM',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'MRI',
      condition: ({ referenceInstance }) =>
        !!(
          referenceInstance?.RepetitionTime ||
          referenceInstance?.EchoTime ||
          referenceInstance?.InversionTime
        ),
      contentF: ({ referenceInstance }) => {
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
