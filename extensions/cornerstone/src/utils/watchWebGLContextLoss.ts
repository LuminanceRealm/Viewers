import { cache } from '@cornerstonejs/core';

type VolumeSummary = { slices: number; rows: number; columns: number; megabytes: number };

/**
 * NUBIX: avisa cuando el navegador le quita el contexto WebGL a cornerstone.
 *
 * Nadie escuchaba `webglcontextlost`: la imagen se quedaba congelada o en
 * blanco y lo único visible era el "Algo salió mal" genérico (ticket del
 * estudio 1186425, serie de 606 cortes de 546×547 en un equipo Windows). La
 * causa habitual es que la tarjeta gráfica no alcanza para lo que se le subió,
 * así que el aviso dice qué reconstrucciones había cargadas. No intenta
 * recuperarse: cornerstone no sabe rehacer sus texturas, hay que recargar.
 *
 * Deja el dato en `window.nubixContextLoss` para el detalle del ErrorBoundary.
 */
export default function watchWebGLContextLoss(renderingEngine, servicesManager): void {
  let canvas: HTMLCanvasElement | undefined;

  try {
    // Con render por CPU no hay ventana offscreen ni contexto que vigilar.
    canvas = renderingEngine.offscreenMultiRenderWindow
      ?.getOpenGLRenderWindow()
      .get3DContext()?.canvas;
  } catch (error) {
    console.warn('watchWebGLContextLoss: no se pudo obtener el canvas', error);
  }

  if (!canvas?.addEventListener) {
    return;
  }

  let notified = false;

  canvas.addEventListener('webglcontextlost', () => {
    const volumes = summarizeVolumes();

    (window as unknown as Record<string, unknown>).nubixContextLoss = {
      at: new Date().toISOString(),
      volumes,
    };

    console.error('WebGL context lost', volumes);

    if (notified) {
      return;
    }
    notified = true;

    const largest = volumes[0];
    const loaded = largest
      ? ` Tenía cargada una reconstrucción de ${largest.slices} cortes de ` +
        `${largest.columns}×${largest.rows} (~${largest.megabytes} MB de memoria de video).`
      : '';

    servicesManager.services.uiNotificationService?.show({
      title: 'La tarjeta gráfica dejó de responder',
      message:
        `Esta computadora perdió la conexión con su tarjeta gráfica.${loaded} ` +
        `Las imágenes en pantalla ya no se actualizan: recarga la página para continuar.` +
        (largest ? ' Si se repite con esta serie, revísala sin MPR.' : ''),
      type: 'error',
      // Con 0 sonner aplica su duración por defecto y el aviso se va solo.
      duration: Infinity,
    });
  });
}

/** Volúmenes en caché, del más pesado al más ligero. */
function summarizeVolumes(): VolumeSummary[] {
  try {
    return cache
      .getVolumes()
      .map(volume => {
        const [columns, rows, slices] = volume.dimensions ?? [];
        // 2 bytes por voxel con 16 bits normalizados; si la GPU no los soporta
        // (probeGpu) el volumen sube como float32 y pesa el doble.
        const { nubixGpuInfo } = window as unknown as { nubixGpuInfo?: { norm16?: boolean } };
        const bytesPerVoxel = nubixGpuInfo?.norm16 === false ? 4 : 2;
        const megabytes = Math.round((columns * rows * slices * bytesPerVoxel) / (1024 * 1024));

        return { slices, rows, columns, megabytes };
      })
      .filter(volume => Number.isFinite(volume.megabytes))
      .sort((a, b) => b.megabytes - a.megabytes);
  } catch (error) {
    return [];
  }
}
