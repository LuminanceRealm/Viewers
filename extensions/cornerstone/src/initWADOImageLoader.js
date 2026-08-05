import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';

const { registerVolumeLoader } = volumeLoader;

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
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
