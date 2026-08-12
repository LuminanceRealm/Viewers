import { utils } from '@ohif/core';

const { formatPN, formatDate } = utils;

export type PrintHeaderInfo = {
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  seriesDescription: string;
  modality: string;
  institution: string;
};

/**
 * Builds the header shown at the top of every printed sheet from a display set.
 * Reads the same instance-level attributes the viewport overlay uses
 * (see Viewport/Overlays/CustomizableViewportOverlay.tsx).
 */
export default function getPrintHeader(displaySet): PrintHeaderInfo {
  const instance = displaySet?.instance ?? displaySet?.instances?.[0] ?? {};

  return {
    patientName: formatPN(instance.PatientName) || '',
    patientId: instance.PatientID || '',
    studyDate: instance.StudyDate ? formatDate(instance.StudyDate) : '',
    studyDescription: instance.StudyDescription || '',
    seriesDescription: displaySet?.SeriesDescription || instance.SeriesDescription || '',
    modality: displaySet?.Modality || instance.Modality || '',
    institution: instance.InstitutionName || '',
  };
}
