import dicomParser from 'dicom-parser';

/** (0042,0011) EncapsulatedDocument en la forma que usa dicom-parser. */
const ENCAPSULATED_DOCUMENT_TAG = 'x00420011';

const cache = new Map();

/**
 * URL http(s) del archivo a partir de la URL del manifiesto. `dicomweb:` se
 * resuelve con el protocolo de la página, igual que hace el image loader.
 */
function toHttpUrl(url) {
  if (url.startsWith('dicomweb:')) {
    return url.replace(/^dicomweb:/, window.location.protocol);
  }
  return url.replace(/^wadouri:/, '');
}

/**
 * Descarga el archivo DICOM de la instancia, extrae los bytes del documento
 * encapsulado y devuelve una URL de Blob lista para un <object>. El resultado
 * se cachea por instancia: el sop class handler la pide para el viewport y
 * para la miniatura, y el archivo se baja una sola vez.
 */
export default function getEncapsulatedDocumentURL(instance, mimeType = 'application/pdf') {
  const key = `${instance.url}#document`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const promise = (async () => {
    const response = await fetch(toHttpUrl(instance.url));
    if (!response.ok) {
      throw new Error(`No se pudo descargar el documento (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const dataSet = dicomParser.parseDicom(bytes);
    const element = dataSet.elements[ENCAPSULATED_DOCUMENT_TAG];
    if (!element) {
      throw new Error('El archivo DICOM no contiene un documento encapsulado');
    }
    let length = element.length;
    // OB rellena a longitud par con un byte nulo; quitarlo para que el PDF quede íntegro.
    const last = element.dataOffset + length - 1;
    if (length % 2 === 0 && bytes[last] === 0) {
      length -= 1;
    }
    const document = bytes.subarray(element.dataOffset, element.dataOffset + length);
    return URL.createObjectURL(new Blob([document], { type: mimeType }));
  })();

  // Si falla, no dejar la promesa rechazada en caché: permitir reintentar.
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
}
