import { imageLoader, metaData, volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';
import { detectGridPattern, suppressGridPattern } from './utils/gridSuppression';

const { registerVolumeLoader } = volumeLoader;

// NUBIX: modalidades en las que se busca el patrón de rejilla antidifusora.
// Mamografía queda fuera a propósito: su detalle fino vive en esas frecuencias.
const GRID_SUPPRESSION_MODALITIES = ['CR', 'DX'];

/**
 * NUBIX: quita el patrón de rejilla grabado en algunas radiografías (moiré al
 * hacer zoom). Se hace sobre el arreglo de píxeles antes de que la imagen
 * llegue al caché y al render, así lo ven igual el viewport, las miniaturas y
 * la impresión. Deja constancia en `image.nubixGridSuppression` para la
 * etiqueta del overlay. Detalle en `utils/gridSuppression.ts`.
 */
function applyGridSuppression(image, imageId) {
  const modality = metaData.get('generalSeriesModule', imageId)?.modality;
  if (!GRID_SUPPRESSION_MODALITIES.includes(modality) || image.color) {
    return;
  }
  const pixels = image.getPixelData?.();
  const { rows, columns } = image;
  if (!pixels || pixels.length !== rows * columns) {
    return;
  }
  const pattern = detectGridPattern(pixels, rows, columns);
  if (!pattern) {
    return;
  }
  suppressGridPattern(pixels, rows, columns, pattern, image.minPixelValue, image.maxPixelValue);
  image.nubixGridSuppression = pattern;
}

function withGridSuppression(loadImage) {
  return (imageId, options) => {
    const loadObject = loadImage(imageId, options);
    // Carga hacia un volumen (TC/RM): no aplica, y los píxeles van a otro búfer.
    if (!loadObject?.promise || options?.targetBuffer) {
      return loadObject;
    }
    loadObject.promise = loadObject.promise.then(image => {
      try {
        applyGridSuppression(image, imageId);
      } catch (error) {
        // Si falla, se muestra la imagen tal cual llegó: nunca peor que antes.
        console.warn('Supresión de rejilla: no se pudo aplicar', error);
      }
      return image;
    });
    return loadObject;
  };
}

export default function initWADOImageLoader(
  userAuthenticationService,
  appConfig,
  extensionManager
) {
  registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

  registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  dicomImageLoader.init({
    maxWebWorkers: Math.min(
      Math.max(navigator.hardwareConcurrency - 1, 1),
      appConfig.maxNumberOfWebWorkers
    ),
    beforeSend: function (xhr) {
      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource()?.[0].getConfig() ?? {};
      const acceptHeader = utils.generateAcceptHeader(
        sourceConfig.acceptHeader,
        sourceConfig.requestTransferSyntaxUID,
        sourceConfig.omitQuotationForMultipartRequest
      );

      // NUBIX: no se manda el header Authorization en la descarga de imagenes.
      //
      // Por que: con el data source `dicomjson` las imagenes siempre vienen de URLs
      // firmadas de CloudFront (?Expires=...&Signature=...&Key-Pair-Id=...). El CDN se
      // autentica con esa firma e ignora el header por completo. Pero `Authorization`
      // nunca esta en la lista segura de CORS, asi que su sola presencia obliga al
      // navegador a mandar un preflight OPTIONS *por cada imagen*. Medido en produccion:
      // ~168 ms de ida y vuelta por imagen, sin transferir un solo byte util.
      //
      // Que NO se rompe: los demas consumidores del token no pasan por aqui.
      // `toggleFeaturedImage` (commandsModule.ts) llama a la API de NUBIX con su propio
      // fetch y arma sus headers aparte, igual que el resto de llamadas a la API.
      // `userAuthenticationService` sigue intacto; solo deja de usarse en esta ruta.
      //
      // Cuando NO aplicaria: si algun dia las imagenes se sirvieran desde un endpoint
      // que exija el token en vez de una URL firmada. Ese caso falla de forma visible
      // (las imagenes no cargan), no en silencio.
      const xhrRequestHeaders = {
        Accept: acceptHeader,
      };

      return xhrRequestHeaders;
    },
    errorInterceptor: error => {
      errorHandler.getHTTPErrorHandler(error);
    },
  });

  // `init` registra estos esquemas con el loadImage de wadouri; se vuelven a
  // registrar envueltos para pasar por la supresión de rejilla.
  const wrapped = withGridSuppression(dicomImageLoader.wadouri.loadImage);
  ['dicomweb', 'wadouri', 'dicomfile'].forEach(scheme =>
    imageLoader.registerImageLoader(scheme, wrapped)
  );
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
