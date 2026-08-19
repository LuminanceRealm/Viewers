import { Enums, utilities as csUtils } from '@cornerstonejs/core';

/**
 * Para VOILUTFunction = SIGMOID, cornerstone coloca el voiRange en
 * logit(0.01) / logit(0.99), es decir en `center ± (ww / 4) · ln(99)`.
 * Cualquier conversion inversa (voiRange -> ventana/nivel) tiene que deshacer
 * exactamente eso; usar la formula lineal infla la ventana 2·ln(99)/4 ≈ 2.2974x
 * en cada ida y vuelta.
 */
const SIGMOID_HALF_SPAN = Math.log(99) / 4;

/**
 * Inversa exacta de `csUtils.windowLevel.toLowHighRange` para las tres
 * VOILUTFunction que soporta cornerstone.
 */
export function toWindowLevel(
  lower: number,
  upper: number,
  voiLUTFunction?: string
): { windowWidth: number; windowCenter: number } {
  if (voiLUTFunction === Enums.VOILUTFunctionType.SAMPLED_SIGMOID) {
    return {
      windowWidth: Math.abs(upper - lower) / (2 * SIGMOID_HALF_SPAN),
      windowCenter: (lower + upper) / 2,
    };
  }

  if (voiLUTFunction === Enums.VOILUTFunctionType.LINEAR_EXACT) {
    return {
      windowWidth: Math.abs(upper - lower),
      windowCenter: (lower + upper) / 2,
    };
  }

  return csUtils.windowLevel.toWindowLevel(lower, upper);
}

export { SIGMOID_HALF_SPAN };
