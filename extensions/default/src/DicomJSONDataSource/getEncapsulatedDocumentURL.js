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

export const ENCAPSULATED_PDF_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.104.1';

/** La instancia es un documento encapsulado (PDF u otro MIME). */
export function isEncapsulatedDocument(instance) {
  return (
    instance?.SOPClassUID === ENCAPSULATED_PDF_SOP_CLASS ||
    Boolean(instance?.MIMETypeOfEncapsulatedDocument)
  );
}

const thumbnailCache = new Map();

/**
 * Miniatura para el navegador de estudios: un icono de documento con la
 * etiqueta del formato (PDF por defecto), como SVG en data URL. No hay
 * servidor que renderice la primera página, y un icono claro es mejor que una
 * fila sin imagen.
 */
export function getDocumentThumbnailURL(instance) {
  const mime = instance?.MIMETypeOfEncapsulatedDocument || 'application/pdf';
  const label = mime.split('/').pop().replace(/^x-/, '').toUpperCase().slice(0, 4) || 'DOC';
  if (thumbnailCache.has(label)) {
    return thumbnailCache.get(label);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="114" viewBox="0 0 128 114">
<rect width="128" height="114" rx="4" fill="#0b1220"/>
<path d="M44 18h28l16 16v62a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" fill="#1f2937" stroke="#9fb3c8" stroke-width="2"/>
<path d="M72 18v16h16" fill="none" stroke="#9fb3c8" stroke-width="2"/>
<rect x="34" y="60" width="60" height="22" rx="3" fill="#d94b3d"/>
<text x="64" y="76" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#fff">${label}</text>
<path d="M50 42h20M50 50h28" stroke="#6b7f95" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  thumbnailCache.set(label, url);
  return url;
}
