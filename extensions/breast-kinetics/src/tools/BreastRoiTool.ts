import { BaseVolumeViewport, getEnabledElement, Types as csTypes } from '@cornerstonejs/core';
import { AnnotationDisplayTool, drawing, utilities as csToolsUtils } from '@cornerstonejs/tools';
import { DicomMetadataStore } from '@ohif/core';

import { IN_PLANE_TOLERANCE_MM, TOOL_NAME, Vec3, roiColor } from '../constants';
import { useKineticsStore } from '../store/useKineticsStore';

const { drawCircle, drawHandles } = drawing;

interface DragState {
  studyUid: string;
  roiId: number;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Estudio al que pertenece la imagen mostrada, si la herramienta está lista para él. */
export function resolveStudyForViewport(viewport: csTypes.IViewport): string | null {
  if (viewport instanceof BaseVolumeViewport) {
    return null;
  }
  const imageId = (viewport as csTypes.IStackViewport).getCurrentImageId?.();
  if (!imageId) {
    return null;
  }
  const instance = DicomMetadataStore.getInstanceByImageId(imageId);
  const studyUid = instance?.StudyInstanceUID;
  if (!studyUid) {
    return null;
  }
  const state = useKineticsStore.getState().byStudy[studyUid];
  return state?.ready ? studyUid : null;
}

export function renderRois(toolGroupIds: string[] = ['default']): void {
  try {
    csToolsUtils.triggerAnnotationRenderForToolGroupIds(toolGroupIds);
  } catch (error) {
    console.warn('BreastRoiTool: no se pudo redibujar', error);
  }
}

/**
 * ROI circular para curvas cinéticas. Clic: nueva ROI centrada en el clic, en
 * el plano del corte, con el radio del panel. Clic sobre una ROI existente y
 * arrastre: la mueve. El store es la única fuente de verdad.
 */
class BreastRoiTool extends AnnotationDisplayTool {
  static toolName = TOOL_NAME;

  private drag: DragState | null = null;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
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

  /** Radio de la ROI en píxeles de canvas, medido sobre el plano de la cámara. */
  private radiusPx(viewport: csTypes.IViewport, center: Vec3, radiusMm: number): number {
    const { viewUp } = viewport.getCamera();
    const edge: Vec3 = [
      center[0] + viewUp[0] * radiusMm,
      center[1] + viewUp[1] * radiusMm,
      center[2] + viewUp[2] * radiusMm,
    ];
    const c = viewport.worldToCanvas(center);
    const e = viewport.worldToCanvas(edge);
    return Math.hypot(e[0] - c[0], e[1] - c[1]);
  }

  private hitRoi(
    viewport: csTypes.IViewport,
    studyUid: string,
    canvas: csTypes.Point2
  ): DragState | null {
    const state = useKineticsStore.getState().byStudy[studyUid];
    if (!state) {
      return null;
    }
    const { focalPoint, viewPlaneNormal } = viewport.getCamera();
    let best: DragState | null = null;
    let bestDist = Infinity;
    state.rois.forEach(roi => {
      const off = Math.abs(
        dot(
          [
            roi.center[0] - focalPoint[0],
            roi.center[1] - focalPoint[1],
            roi.center[2] - focalPoint[2],
          ],
          viewPlaneNormal as Vec3
        )
      );
      if (off > IN_PLANE_TOLERANCE_MM) {
        return;
      }
      const c = viewport.worldToCanvas(roi.center);
      const d = Math.hypot(c[0] - canvas[0], c[1] - canvas[1]);
      const r = this.radiusPx(viewport, roi.center, roi.radiusMm);
      if (d <= Math.max(r, 8) && d < bestDist) {
        bestDist = d;
        best = { studyUid, roiId: roi.id };
      }
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
    if (viewport instanceof BaseVolumeViewport) {
      return this.reject('Las ROIs de curvas se marcan en la vista 2D de la serie.');
    }
    const studyUid = resolveStudyForViewport(viewport);
    if (!studyUid) {
      return this.reject('Inicia las curvas cinéticas en esta serie desde el panel.');
    }

    const hit = this.hitRoi(viewport, studyUid, currentPoints.canvas);
    const store = useKineticsStore.getState();
    if (hit) {
      this.drag = hit;
      store.setActiveRoi(studyUid, hit.roiId);
      renderRois();
      return true;
    }

    const { viewPlaneNormal } = viewport.getCamera();
    store.addRoi(studyUid, currentPoints.world as Vec3, viewPlaneNormal as Vec3);
    renderRois();
    return true;
  };

  mouseDragCallback = (evt): void => {
    if (!this.drag) {
      return;
    }
    const { currentPoints } = evt.detail;
    useKineticsStore
      .getState()
      .moveRoi(this.drag.studyUid, this.drag.roiId, currentPoints.world as Vec3);
    renderRois();
  };

  mouseUpCallback = (): void => {
    this.drag = null;
  };

  renderAnnotation = (enabledElement: csTypes.IEnabledElement, svgDrawingHelper): boolean => {
    const { viewport } = enabledElement;
    const studyUid = resolveStudyForViewport(viewport);
    if (!studyUid) {
      return false;
    }
    const state = useKineticsStore.getState().byStudy[studyUid];
    if (!state?.rois.length) {
      return false;
    }
    const { focalPoint, viewPlaneNormal } = viewport.getCamera();

    state.rois.forEach(roi => {
      const off = Math.abs(
        dot(
          [
            roi.center[0] - focalPoint[0],
            roi.center[1] - focalPoint[1],
            roi.center[2] - focalPoint[2],
          ],
          viewPlaneNormal as Vec3
        )
      );
      const inPlane = off <= IN_PLANE_TOLERANCE_MM;
      const color = roiColor(roi.colorIndex);
      const center = viewport.worldToCanvas(roi.center);
      const radius = this.radiusPx(viewport, roi.center, roi.radiusMm);
      const isActive = roi.id === state.activeRoiId;
      const uid = `kinetics-roi-${roi.id}`;

      drawCircle(svgDrawingHelper, uid, 'circle', center, Math.max(radius, 1), {
        color,
        lineWidth: inPlane ? (isActive ? 2 : 1.5) : 1,
        lineDash: inPlane ? undefined : '2,3',
      });
      if (inPlane) {
        drawHandles(svgDrawingHelper, uid, 'center', [center], {
          color,
          fill: color,
          handleRadius: 2,
        });
      }
    });
    return true;
  };
}

export default BreastRoiTool;
