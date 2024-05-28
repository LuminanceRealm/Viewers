import { ZoomTool } from '@cornerstonejs/tools';

class ZoomTouchTool extends ZoomTool {
  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        zoomToCenter: false,
        minZoomScale: 0.1,
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
