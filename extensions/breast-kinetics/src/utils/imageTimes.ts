import { wadouri } from '@cornerstonejs/dicom-image-loader';

import { parseDicomTime } from './phaseMatching';

export type TimeSource = 'AcquisitionTime' | 'ContentTime' | 'TriggerTime' | null;

export interface ImageTime {
  /** Segundos desde medianoche (o ms de TriggerTime convertidos a s). */
  seconds: number | null;
  source: TimeSource;
}

/**
 * Hora de adquisición leída del propio archivo DICOM, ya parseado en la caché
 * del loader tras cargar la imagen. El manifiesto de la API no sirve para esto:
 * su AcquisitionTime es la hora del estudio, igual para todas las imágenes.
 */
export function readImageTime(imageId: string): ImageTime {
  try {
    const { url } = wadouri.parseImageId(imageId);
    if (!wadouri.dataSetCacheManager.isLoaded(url)) {
      return { seconds: null, source: null };
    }
    const dataSet = wadouri.dataSetCacheManager.get(url);
    if (!dataSet) {
      return { seconds: null, source: null };
    }
    const acquisition = parseDicomTime(dataSet.string('x00080032'));
    if (acquisition !== null) {
      return { seconds: acquisition, source: 'AcquisitionTime' };
    }
    const content = parseDicomTime(dataSet.string('x00080033'));
    if (content !== null) {
      return { seconds: content, source: 'ContentTime' };
    }
    const trigger = dataSet.floatString('x00181060');
    if (Number.isFinite(trigger)) {
      return { seconds: (trigger as number) / 1000, source: 'TriggerTime' };
    }
  } catch (error) {
    console.warn('readImageTime: no se pudo leer la hora del archivo', imageId, error);
  }
  return { seconds: null, source: null };
}
