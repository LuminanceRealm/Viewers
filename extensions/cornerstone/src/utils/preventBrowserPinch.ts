const prepared = new WeakSet<HTMLElement>();

const preventMultiTouch = (evt: TouchEvent) => {
  if (evt.touches.length > 1) {
    evt.preventDefault();
  }
};
const preventGesture = (evt: Event) => evt.preventDefault();

/**
 * NUBIX: sobre la imagen, el pellizco es del visor (herramienta PinchZoom),
 * no del navegador. Safari en iPhone ignora `user-scalable=no` del viewport
 * meta y hacía zoom a la página entera: la barra y los paneles se salían de
 * la pantalla y el texto del overlay quedaba enorme. cornerstone escucha los
 * toques pero no llama a preventDefault ni pone touch-action.
 *
 * Sólo se bloquea sobre el elemento del viewport; en el resto de la app
 * (paneles, listas) el navegador se comporta igual que antes.
 */
export default function preventBrowserPinch(element: HTMLElement) {
  if (!element || prepared.has(element)) {
    return;
  }
  prepared.add(element);
  element.style.touchAction = 'none';
  element.addEventListener('touchmove', preventMultiTouch, { passive: false });
  // Eventos propios de Safari para el pellizco y el giro.
  element.addEventListener('gesturestart', preventGesture, { passive: false });
  element.addEventListener('gesturechange', preventGesture, { passive: false });
}
