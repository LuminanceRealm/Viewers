export default {
  'viewportOverlay.topLeft': [
    {
      id: 'PatientId',
      inheritsFrom: 'ohif.overlayItem',
      label: 'ID: ',
      title: 'Patient ID',
      color: '#cbcdd3',
      condition: ({ referenceInstance }) => !!referenceInstance?.PatientID,
      contentF: ({ referenceInstance }) => referenceInstance.PatientID,
    },
    {
      id: 'PatientName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient',
      color: '#5fbeaa',
      condition: ({ referenceInstance }) => !!referenceInstance?.PatientName,
      contentF: ({ referenceInstance }) => referenceInstance.PatientName,
    },
    {
      id: 'PatientSexAndAge',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Sex/Age/DOB',
      color: '#cbcdd3',
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
      color: '#cbcdd3',
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
      color: '#98a6ad',
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
      color: '#98a6ad',
      condition: ({ referenceInstance }) => !!referenceInstance?.StudyDescription,
      contentF: ({ referenceInstance }) => referenceInstance.StudyDescription,
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: 'SE: ',
      title: 'Series',
      color: '#98a6ad',
      condition: ({ referenceInstance }) => !!referenceInstance?.SeriesDescription,
      contentF: ({ referenceInstance }) => referenceInstance.SeriesDescription,
    },
    {
      id: 'SequenceName',
      inheritsFrom: 'ohif.overlayItem',
      label: 'SQ: ',
      title: 'Sequence',
      color: '#98a6ad',
      condition: ({ referenceInstance }) => !!referenceInstance?.SequenceName,
      contentF: ({ referenceInstance }) => referenceInstance.SequenceName,
    },
    {
      id: 'OperatorsName',
      inheritsFrom: 'ohif.overlayItem',
      label: 'OP: ',
      title: 'Operator',
      color: '#98a6ad',
      condition: ({ referenceInstance }) => !!referenceInstance?.OperatorsName,
      contentF: ({ referenceInstance }) => referenceInstance.OperatorsName,
    },
  ],

  'viewportOverlay.bottomLeft': [
    {
      id: 'WindowLevel',
      inheritsFrom: 'ohif.overlayItem.windowLevel',
      label: '',
      color: '#98a6ad',
    },
    {
      id: 'ZoomLevel',
      inheritsFrom: 'ohif.overlayItem.zoomLevel',
      label: '',
      color: '#98a6ad',
      condition: props =>
        props.toolGroupService.getActiveToolForViewport(props.viewportId) === 'Zoom',
    },
    {
      id: 'SeqParams',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Seq Params',
      color: '#98a6ad',
      condition: ({ referenceInstance }) =>
        !!(
          referenceInstance?.PixelBandwidth ||
          referenceInstance?.ReceiveCoilName ||
          referenceInstance?.TransmitCoilName ||
          referenceInstance?.AcquisitionDuration ||
          referenceInstance?.SAR
        ),
      contentF: ({ referenceInstance }) => {
        const parts = [];
        if (referenceInstance.PixelBandwidth) {
          parts.push(`BW:${referenceInstance.PixelBandwidth}`);
        }
        if (referenceInstance.ReceiveCoilName) {
          parts.push(referenceInstance.ReceiveCoilName);
        }
        if (referenceInstance.TransmitCoilName) {
          parts.push(`Tx:${referenceInstance.TransmitCoilName}`);
        }
        if (referenceInstance.AcquisitionDuration) {
          parts.push(`Dur:${referenceInstance.AcquisitionDuration}`);
        }
        if (referenceInstance.SAR) {
          parts.push(`SAR:${referenceInstance.SAR}`);
        }
        return parts.join(' ');
      },
    },
    {
      id: 'PatientOrientation',
      inheritsFrom: 'ohif.overlayItem',
      label: 'ORI: ',
      title: 'Orientation',
      color: '#98a6ad',
      condition: ({ referenceInstance }) => Array.isArray(referenceInstance?.PatientOrientation),
      contentF: ({ referenceInstance }) => referenceInstance.PatientOrientation.join('>'),
    },
    {
      id: 'Pos',
      inheritsFrom: 'ohif.overlayItem',
      label: 'POS: ',
      title: 'Position',
      color: '#98a6ad',
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
      color: '#98a6ad',
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
      color: '#98a6ad',
      condition: ({ referenceInstance }) => !!referenceInstance?.ManufacturerModelName,
      contentF: ({ referenceInstance }) => referenceInstance.ManufacturerModelName,
    },
  ],

  'viewportOverlay.bottomRight': [
    {
      id: 'InstanceNumber',
      inheritsFrom: 'ohif.overlayItem.instanceNumber',
      label: 'IN: ',
      color: '#98a6ad',
    },
    {
      id: 'SliceThickness',
      inheritsFrom: 'ohif.overlayItem',
      label: 'TH: ',
      title: 'Thickness',
      color: '#98a6ad',
      condition: ({ referenceInstance }) => !!referenceInstance?.SliceThickness,
      contentF: ({ referenceInstance }) => `${referenceInstance.SliceThickness}mm`,
    },
    {
      id: 'Calc',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Calculated',
      color: '#98a6ad',
      condition: ({ referenceInstance }) =>
        (!!referenceInstance?.PixelSpacing &&
          referenceInstance?.Columns &&
          referenceInstance?.Rows) ||
        !!referenceInstance?.NumberOfFrames ||
        !!referenceInstance?.SpacingBetweenSlices ||
        !!referenceInstance?.ReconstructionDiameter,
      contentF: ({ referenceInstance }) => {
        const parts = [];
        const ps = referenceInstance.PixelSpacing;
        const {
          Columns: cols,
          Rows: rows,
          NumberOfFrames: frames,
          SpacingBetweenSlices: sbs,
          ReconstructionDiameter: rd,
        } = referenceInstance;
        if (ps && cols && rows) {
          const fovX = (ps[0] * cols).toFixed(1);
          const fovY = (ps[1] * rows).toFixed(1);
          parts.push(`FoV:${fovX}×${fovY}mm`);
        }
        if (sbs) {
          parts.push(`Gap:${sbs}mm`);
        }
        if (rd) {
          parts.push(`RD:${rd}mm`);
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
      color: '#98a6ad',
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
      id: 'MRI',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'MRI',
      color: '#98a6ad',
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
