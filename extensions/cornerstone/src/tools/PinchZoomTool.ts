import { ZoomTool } from '@cornerstonejs/tools';

/**
 * NUBIX: pellizco con dos dedos para acercar y alejar (y moverse) en
 * teléfonos y tabletas, sin quitarle el dedo único a la herramienta activa
 * (recorrer cortes, por defecto). Es una herramienta aparte de "Zoom" porque
 * ésa usa el arrastre de un dedo cuando se elige en la barra.
 *
 * Cornerstone elige la herramienta en cada movimiento según cuántos dedos hay,
 * así que basta con atarla a `numTouchPoints: 2` en cada grupo de
 * herramientas. Al pasar de uno a dos dedos el despachador reporta distancia
 * cero en ese cuadro, así que no hay salto.
 */
class PinchZoomTool extends ZoomTool {
  static toolName = 'PinchZoom';

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Touch'],
      configuration: {
        zoomToCenter: false,
        // Mismo rango que ZoomTouchTool: con 0.1 una mamografía de 0.05 mm
        // ya está por debajo del mínimo al ajustarse a la pantalla.
        minZoomScale: 0.01,
        maxZoomScale: 30,
        pinchToZoom: true,
        pan: true,
        invert: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }
}

export default PinchZoomTool;
