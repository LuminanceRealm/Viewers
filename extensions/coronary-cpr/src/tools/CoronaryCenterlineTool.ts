import {
  BaseVolumeViewport,
  getEnabledElement,
  Types as csTypes,
  utilities as csUtils,
} from '@cornerstonejs/core';
import { AnnotationDisplayTool, drawing, utilities as csToolsUtils } from '@cornerstonejs/tools';

import { ARTERIES, IN_PLANE_TOLERANCE_MM, TOOL_NAME, Vec3, arteryCss } from '../constants';
import { useCprStore } from '../store/useCprStore';
import { resampleCatmullRom, dot, sub } from '../utils/centerlineGeometry';
import { snapToLumen } from '../utils/snapToLumen';
import { getVolumeSampler, VolumeSampler } from '../utils/volumeSampler';

const { drawPolyline, drawHandles, drawCircle } = drawing;

interface DragState {
  uid: string;
  arteryId: number;
  index: number;
}

/**
 * Serie que muestra un viewport, resuelta contra los muestreadores ya
 * preparados: por volumeId en MPR y por imageId actual en stack.
 */
export function resolveSeriesForViewport(
  viewport: csTypes.IViewport
): { uid: string; sampler: VolumeSampler } | null {
  const candidates = useCprStore.getState().bySeries;
  const uids = Object.keys(candidates).filter(uid => candidates[uid].ready);
  if (!uids.length) {
    return null;
  }

  if (viewport instanceof BaseVolumeViewport) {
    const volumeId = (viewport as csTypes.IVolumeViewport).getVolumeId?.() ?? '';
    for (const uid of uids) {
      if (volumeId.includes(uid)) {
        const sampler = getVolumeSampler(uid);
        if (sampler) {
          return { uid, sampler };
        }
      }
    }
    return null;
  }

  const stack = viewport as csTypes.IStackViewport;
  const imageId = stack.getCurrentImageId?.();
  if (!imageId) {
    return null;
  }
  for (const uid of uids) {
    const sampler = getVolumeSampler(uid);
    if (sampler && sampler.imageIds.includes(imageId)) {
      return { uid, sampler };
    }
  }
  return null;
}

/** Vuelve a dibujar el trazado en todos los viewports de los toolgroups dados. */
export function renderCenterlines(toolGroupIds: string[] = ['default', 'mpr']): void {
  try {
    csToolsUtils.triggerAnnotationRenderForToolGroupIds(toolGroupIds);
  } catch (error) {
    console.warn('CoronaryCenterlineTool: no se pudo redibujar', error);
  }
}

/**
 * Trazado de la centerline coronaria.
 *
 * Clic: añade un punto a la arteria activa, imantado al lumen contrastado del
 * plano del viewport. Clic sobre un punto existente y arrastre: lo mueve. El
 * store es la única fuente de verdad; esta herramienta sólo dibuja y edita.
 */
class CoronaryCenterlineTool extends AnnotationDisplayTool {
  static toolName = TOOL_NAME;

  private drag: DragState | null = null;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        /** Radio en píxeles de canvas para "agarrar" un punto existente. */
        hitRadiusPx: 10,
        handleRadiusPx: 4,
        onRejected: undefined as ((reason: string) => void) | undefined,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  private reject(reason: string): boolean {
    const { onRejected } = this.configuration;
    if (typeof onRejected === 'function') {
      onRejected(reason);
    }
    return true;
  }

  private planeTolerance(viewport: csTypes.IViewport, sampler: VolumeSampler): number {
    const base = Math.max(IN_PLANE_TOLERANCE_MM, sampler.spacing[2] / 2);
    if (viewport instanceof BaseVolumeViewport) {
      try {
        const { spacingInNormalDirection } = csUtils.getTargetVolumeAndSpacingInNormalDir(
          viewport as csTypes.IVolumeViewport,
          viewport.getCamera()
        );
        return Math.max(base, spacingInNormalDirection / 2);
      } catch {
        return base;
      }
    }
    return base;
  }

  private findHandle(
    viewport: csTypes.IViewport,
    uid: string,
    canvas: csTypes.Point2,
    tolerance: number
  ): DragState | null {
    const series = useCprStore.getState().bySeries[uid];
    if (!series) {
      return null;
    }
    const { focalPoint, viewPlaneNormal } = viewport.getCamera();
    const hit = this.configuration.hitRadiusPx;
    let best: DragState | null = null;
    let bestDist = Infinity;

    // La arteria activa tiene prioridad, luego las demás.
    const order = [
      series.activeArtery,
      ...ARTERIES.map(a => a.id).filter(id => id !== series.activeArtery),
    ];
    order.forEach(arteryId => {
      (series.arteries[arteryId] ?? []).forEach((p, index) => {
        const offPlane = Math.abs(dot(sub(p, focalPoint as Vec3), viewPlaneNormal as Vec3));
        if (offPlane > tolerance) {
          return;
        }
        const c = viewport.worldToCanvas(p);
        const d = Math.hypot(c[0] - canvas[0], c[1] - canvas[1]);
        if (d <= hit && d < bestDist) {
          bestDist = d;
          best = { uid, arteryId, index };
        }
      });
    });
    return best;
  }

  preMouseDownCallback = (evt): boolean => {
    const { element, currentPoints } = evt.detail;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) {
      return false;
    }
    const { viewport } = enabledElement;

    const resolved = resolveSeriesForViewport(viewport);
    if (!resolved) {
      return this.reject('Inicia el CPR coronario en esta serie desde el panel.');
    }
    const { uid, sampler } = resolved;
    const store = useCprStore.getState();
    const series = store.bySeries[uid];

    const tolerance = this.planeTolerance(viewport, sampler);
    const handle = this.findHandle(viewport, uid, currentPoints.canvas, tolerance);
    if (handle) {
      this.drag = handle;
      return true;
    }

    const world = currentPoints.world as Vec3;
    const { viewPlaneNormal } = viewport.getCamera();
    const point = series.snapEnabled
      ? snapToLumen(
          { huAtWorld: sampler.huAtWorld, minSpacingMm: Math.min(...sampler.spacing) },
          world,
          viewPlaneNormal as Vec3
        )
      : world;

    store.addPoint(uid, series.activeArtery, point);
    renderCenterlines();
    return true;
  };

  mouseDragCallback = (evt): void => {
    if (!this.drag) {
      return;
    }
    const { element, currentPoints } = evt.detail;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) {
      return;
    }
    const { uid, arteryId, index } = this.drag;
    useCprStore.getState().movePoint(uid, arteryId, index, currentPoints.world as Vec3);
    renderCenterlines();
  };

  mouseUpCallback = (): void => {
    this.drag = null;
  };

  renderAnnotation = (enabledElement: csTypes.IEnabledElement, svgDrawingHelper): boolean => {
    const { viewport } = enabledElement;
    const resolved = resolveSeriesForViewport(viewport);
    if (!resolved) {
      return false;
    }
    const { uid, sampler } = resolved;
    const series = useCprStore.getState().bySeries[uid];
    if (!series) {
      return false;
    }

    const { focalPoint, viewPlaneNormal } = viewport.getCamera();
    const tolerance = this.planeTolerance(viewport, sampler);
    const handleRadius = this.configuration.handleRadiusPx;

    ARTERIES.forEach(artery => {
      const points = series.arteries[artery.id] ?? [];
      if (!points.length) {
        return;
      }
      const isActive = artery.id === series.activeArtery;
      const color = arteryCss(artery.color);
      const dimColor = arteryCss([artery.color[0], artery.color[1], artery.color[2], 110]);
      const uidPrefix = `cpr-${artery.id}`;

      if (points.length >= 2) {
        const curve = resampleCatmullRom(points, 1);
        const canvasPoints = curve.map(p => viewport.worldToCanvas(p));
        drawPolyline(svgDrawingHelper, uidPrefix, 'curve', canvasPoints, {
          color: isActive ? color : dimColor,
          lineWidth: isActive ? 1.5 : 1,
          lineDash: isActive ? undefined : '3,3',
        });
      }

      const inPlane: csTypes.Point2[] = [];
      const offPlane: csTypes.Point2[] = [];
      points.forEach(p => {
        const off = Math.abs(dot(sub(p, focalPoint as Vec3), viewPlaneNormal as Vec3));
        (off <= tolerance ? inPlane : offPlane).push(viewport.worldToCanvas(p));
      });

      if (inPlane.length) {
        drawHandles(svgDrawingHelper, uidPrefix, 'handles', inPlane, {
          color,
          fill: color,
          handleRadius: isActive ? handleRadius : handleRadius - 1,
        });
      }
      offPlane.forEach((c, n) => {
        drawCircle(svgDrawingHelper, uidPrefix, `off-${n}`, c, 2, {
          color: dimColor,
          lineWidth: 1,
        });
      });
    });

    return true;
  };
}

export default CoronaryCenterlineTool;
