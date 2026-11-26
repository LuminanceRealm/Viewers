import { cache } from '@cornerstonejs/core';
import GpuLostDialog from '../components/GpuLostDialog';
import { clearSessionVolumeSliceLimit, setSessionVolumeSliceLimit } from './maxVolumeSlices';

const MIN_PARTIAL_SLICES = 20;

type VolumeSummary = { slices: number; rows: number; columns: number; megabytes: number };

type GpuFailure = 'context-lost' | 'out-of-memory';

// Uno por carga de página: tras cualquiera de las dos fallas hay que recargar.
let notified = false;

function getContext(renderingEngine): WebGL2RenderingContext | undefined {
  try {
    // Con render por CPU no hay ventana offscreen ni contexto que vigilar.
    return renderingEngine.offscreenMultiRenderWindow?.getOpenGLRenderWindow().get3DContext();
  } catch (error) {
    console.warn('watchWebGLContextLoss: no se pudo obtener el contexto', error);
  }
}

/**
 * NUBIX: avisa cuando el navegador le quita el contexto WebGL a cornerstone.
 *
 * Nadie escuchaba `webglcontextlost`: la imagen se quedaba congelada o en
 * blanco y lo único visible era el "Algo salió mal" genérico (ticket del
 * estudio 1186425, serie de 606 cortes de 546×547 en un equipo Windows). La
 * causa habitual es que la tarjeta gráfica no alcanza para lo que se le subió,
 * así que el aviso dice qué reconstrucciones había cargadas. No intenta
 * recuperarse: cornerstone no sabe rehacer sus texturas, hay que recargar. Lo
 * que sí ofrece es recargar con un tope de cortes (dos tercios), a elección del
 * usuario: el sub-rango a resolución nativa de CornerstoneCacheService.
 *
 * Deja el dato en `window.nubixContextLoss` para el detalle del ErrorBoundary.
 */
export default function watchWebGLContextLoss(renderingEngine, servicesManager): void {
  const canvas = getContext(renderingEngine)?.canvas as HTMLCanvasElement | undefined;

  if (!canvas?.addEventListener) {
    return;
  }

  canvas.addEventListener('webglcontextlost', () =>
    reportGpuFailure(servicesManager, 'context-lost')
  );
}

/**
 * NUBIX: la otra forma de fallar, sin evento. En el mismo equipo, un volumen
 * algo más chico que el que tumba el contexto (404 de 606 cortes) no lo tumba:
 * la reserva de la textura falla con GL_OUT_OF_MEMORY, vtk no revisa el error y
 * los tres planos quedan en negro sin aviso ni forma de pedir menos cortes.
 * Por eso, después de asignar un volumen a un viewport, se le pregunta al
 * contexto un par de veces si quedó algún error. `getError` vacía la bandera;
 * a vtk no le afecta porque nunca la lee.
 */
export function scheduleGpuHealthCheck(renderingEngine, servicesManager): void {
  [1500, 6000, 15000].forEach(delay =>
    window.setTimeout(() => {
      const gl = getContext(renderingEngine);

      if (!gl || notified) {
        return;
      }

      if (gl.isContextLost()) {
        reportGpuFailure(servicesManager, 'context-lost');
        return;
      }

      const errors: number[] = [];
      for (let i = 0; i < 8; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) {
          break;
        }
        errors.push(error);
      }

      if (errors.length) {
        // Para el detalle del ErrorBoundary, que imprime nubixGpuInfo entero.
        const info = (window as unknown as { nubixGpuInfo?: Record<string, unknown> }).nubixGpuInfo;
        if (info) {
          info.glErrors = [...((info.glErrors as number[]) ?? []), ...errors].slice(-16);
        }
        console.warn('WebGL errors after setting a volume', errors);
      }

      if (errors.includes(gl.OUT_OF_MEMORY)) {
        reportGpuFailure(servicesManager, 'out-of-memory');
      }
    }, delay)
  );
}

function reportGpuFailure(servicesManager, reason: GpuFailure): void {
  const volumes = summarizeVolumes();

  (window as unknown as Record<string, unknown>).nubixContextLoss = {
    at: new Date().toISOString(),
    reason,
    volumes,
  };

  console.error(`GPU failure (${reason})`, volumes);

  if (notified) {
    return;
  }
  notified = true;

  const largest = volumes[0];
  const { uiModalService, displaySetService } = servicesManager.services;

  // Si lo que se cayó ya era una reconstrucción parcial, el total es el de la
  // serie; así los pasos se leen sobre la serie entera (100 → 66 → 44 → 30 %).
  const partial = largest
    ? displaySetService
        ?.getActiveDisplaySets()
        .map(displaySet => displaySet.volumeSubRange)
        .find(subRange => subRange?.count === largest.slices)
    : undefined;
  const totalSlices = partial?.total ?? largest?.slices ?? 0;

  // Dos tercios de lo que no se pudo sostener (decisión de Arturo: bajar de
  // 33 % en 33 %, no a la mitad). Menos de ~20 cortes ya no es una
  // reconstrucción útil y deja de ofrecerse.
  const next = largest ? Math.round((largest.slices * 2) / 3) : 0;
  const fewerSlices = next >= MIN_PARTIAL_SLICES ? next : 0;

  const reload = () => window.location.reload();

  uiModalService?.show({
    title:
      reason === 'out-of-memory'
        ? 'La tarjeta gráfica no tiene memoria suficiente'
        : 'La tarjeta gráfica dejó de responder',
    content: GpuLostDialog,
    contentProps: {
      slices: largest?.slices ?? 0,
      totalSlices,
      columns: largest?.columns,
      rows: largest?.rows,
      megabytes: largest?.megabytes,
      fewerSlices,
      // "Recargar completa" promete la serie entera: quita el tope que
      // hubiera de una caída anterior.
      onReload: () => {
        clearSessionVolumeSliceLimit();
        reload();
      },
      onReloadWithFewer: () => {
        setSessionVolumeSliceLimit(fewerSlices);
        reload();
      },
    },
    // Detrás no queda nada utilizable: que no se cierre por accidente.
    shouldCloseOnEsc: false,
    shouldCloseOnOverlayClick: false,
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
