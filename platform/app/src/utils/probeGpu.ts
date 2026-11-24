/**
 * NUBIX: lo que el navegador deja saber de la tarjeta gráfica de este equipo.
 *
 * Se mide una sola vez al arrancar (los contextos WebGL son un recurso
 * limitado: crear de más hace que el navegador descarte los vivos) y se deja en
 * `window.nubixGpuInfo`, de donde lo leen el detalle del ErrorBoundary y el
 * aviso de pérdida de contexto. No hay forma de preguntar cuánta memoria de
 * video existe; esto es lo más cercano.
 */
export type GpuInfo = {
  webgl2: boolean;
  renderer?: string;
  vendor?: string;
  max3DTextureSize?: number;
  maxTextureSize?: number;
  /** Sin esto un volumen de 16 bits sube como float32: el doble de memoria. */
  norm16?: boolean;
  floatLinear?: boolean;
  deviceMemoryGB?: number;
  hardwareConcurrency?: number;
  devicePixelRatio?: number;
};

export default function probeGpu(): GpuInfo {
  const info: GpuInfo = { webgl2: false };

  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    info.deviceMemoryGB = nav.deviceMemory;
    info.hardwareConcurrency = nav.hardwareConcurrency;
    info.devicePixelRatio = window.devicePixelRatio;

    const gl = document.createElement('canvas').getContext('webgl2');

    if (gl) {
      info.webgl2 = true;
      info.max3DTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      info.norm16 = !!gl.getExtension('EXT_texture_norm16');
      info.floatLinear = !!gl.getExtension('OES_texture_float_linear');

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        info.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        info.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      }
    }
  } catch (error) {
    console.warn('probeGpu failed', error);
  }

  (window as unknown as { nubixGpuInfo: GpuInfo }).nubixGpuInfo = info;

  return info;
}
