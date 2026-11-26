import { cache } from '@cornerstonejs/core';
import { toast } from 'sonner';
import { setSessionVolumeSliceLimit } from './maxVolumeSlices';

type VolumeSummary = { slices: number; rows: number; columns: number; megabytes: number };

/**
 * NUBIX: avisa cuando el navegador le quita el contexto WebGL a cornerstone.
 *
 * Nadie escuchaba `webglcontextlost`: la imagen se quedaba congelada o en
 * blanco y lo único visible era el "Algo salió mal" genérico (ticket del
 * estudio 1186425, serie de 606 cortes de 546×547 en un equipo Windows). La
 * causa habitual es que la tarjeta gráfica no alcanza para lo que se le subió,
 * así que el aviso dice qué reconstrucciones había cargadas. No intenta
 * recuperarse: cornerstone no sabe rehacer sus texturas, hay que recargar. Lo
 * que sí ofrece es recargar con un tope de cortes (la mitad), a elección del
 * usuario: el sub-rango a resolución nativa de CornerstoneCacheService.
 *
 * Deja el dato en `window.nubixContextLoss` para el detalle del ErrorBoundary.
 */
export default function watchWebGLContextLoss(renderingEngine): void {
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
    // La mitad de lo que no se pudo sostener; si vuelve a caerse, se ofrece la
    // mitad de eso. Menos de ~20 cortes ya no es una reconstrucción útil.
    const fewerSlices = largest ? Math.floor(largest.slices / 2) : 0;
    const canOfferPartial = fewerSlices >= 20;

    const loaded = largest
      ? ` Tenía cargada una reconstrucción de ${largest.slices} cortes de ` +
        `${largest.columns}×${largest.rows} (~${largest.megabytes} MB de memoria de video).`
      : '';

    const reload = () => window.location.reload();

    // sonner directo y no uiNotificationService: hace falta el botón, y con
    // `duration: 0` sonner aplica su duración por defecto (para fijo, Infinity).
    toast.error('La tarjeta gráfica dejó de responder', {
      description:
        `Esta computadora perdió la conexión con su tarjeta gráfica.${loaded} ` +
        `Las imágenes en pantalla ya no se actualizan y hay que recargar la página.` +
        (canOfferPartial
          ? ` Puedes recargar y reconstruir sólo ${fewerSlices} cortes alrededor del corte ` +
            `que estés viendo, a resolución completa: las mediciones siguen siendo exactas, ` +
            `pero la reconstrucción no abarca toda la serie.`
          : ''),
      duration: Infinity,
      action: canOfferPartial
        ? {
            label: `Recargar con ${fewerSlices} cortes`,
            onClick: () => {
              setSessionVolumeSliceLimit(fewerSlices);
              reload();
            },
          }
        : { label: 'Recargar', onClick: reload },
      cancel: canOfferPartial ? { label: 'Sólo recargar', onClick: reload } : undefined,
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
