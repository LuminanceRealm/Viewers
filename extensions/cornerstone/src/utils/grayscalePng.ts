/**
 * Codificador de PNG en escala de grises de 8 bits (colorType 0).
 *
 * `canvas.toDataURL('image/png')` siempre produce RGBA, y Basic Grayscale
 * Print Management necesita MONOCHROME2. Convertir del lado del agente
 * significaría mandar el triple de bytes por la red de la clínica y darle al
 * agente un decodificador de PNG completo, así que la conversión se hace aquí.
 *
 * El agente decodifica exactamente este subtipo (ver services/printer/png.ts
 * en el repo de NUBIX OS 2).
 */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) {
    return crcTable;
  }

  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }

  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);

  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // CompressionStream('deflate') entrega el envoltorio zlib, que es justo lo
  // que espera un IDAT
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Convierte el canvas a luminancia de 8 bits usando los coeficientes Rec. 601,
 * los mismos que usa cualquier conversión a monocromo estándar.
 */
export function canvasToGrayscale(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo obtener el contexto 2D del canvas');
  }

  const { width, height } = canvas;
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    pixels[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }

  return { width, height, pixels };
}

export async function encodeGrayscalePng(
  width: number,
  height: number,
  pixels: Uint8Array
): Promise<Blob> {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colorType 0 = escala de grises
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sin entrelazar

  // Filtro 0 (None) en cada fila: el costo de elegir filtro no se paga en
  // capturas de pantalla y mantiene el codificador trivialmente verificable
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const idat = await deflate(raw);

  return new Blob(
    [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))],
    { type: 'image/png' }
  );
}

/** Atajo: canvas -> PNG gris de 8 bits listo para subir. */
export async function canvasToGrayscalePng(canvas: HTMLCanvasElement): Promise<Blob> {
  const { width, height, pixels } = canvasToGrayscale(canvas);
  return encodeGrayscalePng(width, height, pixels);
}
