import { ZoomTool } from '@cornerstonejs/tools';

class ZoomTouchTool extends ZoomTool {
  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        zoomToCenter: false,
        // NUBIX: la escala es píxeles de pantalla por píxel de imagen. Una
        // mamografía de 5928 filas a 0.05 mm ajustada a la pantalla ya queda
        // en ~0.08; con un mínimo de 0.1 el primer paso de zoom se recortaba
        // y acercaba al centro del viewport (el fondo negro), no al dedo.
        minZoomScale: 0.01,
        maxZoomScale: 30,
        pinchToZoom: false,
        pan: true,
        invert: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }
}

ZoomTouchTool.toolName = 'Zoom';
export default ZoomTouchTool;
