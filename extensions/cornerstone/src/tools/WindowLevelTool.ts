import { WindowLevelTool as CornerstoneWindowLevelTool } from '@cornerstonejs/tools';
import { utilities as csUtils } from '@cornerstonejs/core';

import { toWindowLevel } from '../utils/windowLevel';

const DEFAULT_MULTIPLIER = 4;

/**
 * WindowLevelTool que respeta la VOILUTFunction al convertir el voiRange
 * actual a ventana/nivel.
 *
 * El tool de cornerstone lee el rango con la formula lineal y lo vuelve a
 * escribir con la formula de la VOILUTFunction del viewport. Con SIGMOID
 * (mastografia GE Senographe, entre otros) la ida y vuelta no es identidad:
 * cada mousemove multiplica la ventana por ~2.3, asi que en un solo arrastre
 * la ventana pasa de ~950 a 1e14 y la imagen queda gris uniforme.
 */
class WindowLevelTool extends CornerstoneWindowLevelTool {
  getNewRange({ viewport, deltaPointsCanvas, volumeId, lower, upper }) {
    const voiLUTFunction = viewport.getProperties().VOILUTFunction;
    const multiplier =
      this._getMultiplierFromDynamicRange(viewport, volumeId) || DEFAULT_MULTIPLIER;

    let { windowWidth, windowCenter } = toWindowLevel(lower, upper, voiLUTFunction);

    windowWidth = Math.max(windowWidth + deltaPointsCanvas[0] * multiplier, 1);
    windowCenter += deltaPointsCanvas[1] * multiplier;

    return csUtils.windowLevel.toLowHighRange(windowWidth, windowCenter, voiLUTFunction);
  }
}

WindowLevelTool.toolName = 'WindowLevel';

export default WindowLevelTool;
