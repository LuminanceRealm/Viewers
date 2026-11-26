/**
 * How many slices this machine's GPU can hold in a single 3D texture.
 *
 * The value is `gl.MAX_3D_TEXTURE_SIZE`, probed once at startup in
 * platform/app/src/App.tsx and written onto appConfig. It is reached through
 * here because CornerstoneCacheService — where volumes are actually built — is
 * constructed with only a servicesManager and never sees appConfig.
 *
 * We hold the appConfig object and read the property on demand rather than
 * copying the number at init time: extension init runs inside appInit, which
 * completes *before* App.tsx probes the GPU, so an eager read would always see
 * undefined. Both refer to the same object (appInit.js:44 creates it, passes it
 * to the extension manager, and returns it for App.tsx to annotate), so a late
 * read sees the probed value.
 *
 * Deliberately not probed again from here: WebGL contexts are a limited
 * resource and creating extra ones makes the browser discard live ones.
 */

let appConfigRef: Record<string, unknown> | undefined;

/** Called from the cornerstone extension's init, which has appConfig in scope. */
export function setVolumeSliceLimitSource(appConfig: Record<string, unknown>): void {
  appConfigRef = appConfig;
}

/**
 * NUBIX: tope de cortes que el usuario aceptó después de que la tarjeta gráfica
 * se cayó cargando un volumen (watchWebGLContextLoss). Vive en sessionStorage:
 * la página tiene que recargarse tras la caída, y el tope es de **esta pestaña
 * en este equipo**, no del estudio; al cerrar la pestaña desaparece.
 */
const SESSION_LIMIT_KEY = 'nubix.maxVolumeSlices';

export function getSessionVolumeSliceLimit(): number | undefined {
  try {
    const value = Number(window.sessionStorage.getItem(SESSION_LIMIT_KEY));

    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch (error) {
    return undefined;
  }
}

export function setSessionVolumeSliceLimit(slices: number): void {
  try {
    window.sessionStorage.setItem(SESSION_LIMIT_KEY, String(Math.floor(slices)));
  } catch (error) {
    console.warn('No se pudo guardar el tope de cortes de la sesión', error);
  }
}

/**
 * Returns the slice ceiling, or undefined when it could not be determined — in
 * which case callers must leave the volume alone rather than guess at a limit.
 * It is the GPU's 3D texture depth, lowered by the session limit when there is
 * one.
 */
export function getMaxVolumeSlices(): number | undefined {
  const value = appConfigRef?.max3DTextureSize as number | undefined;
  const gpuLimit = Number.isFinite(value) && value > 0 ? value : undefined;
  const sessionLimit = getSessionVolumeSliceLimit();

  if (gpuLimit && sessionLimit) {
    return Math.min(gpuLimit, sessionLimit);
  }

  return sessionLimit ?? gpuLimit;
}
