import { BaseVolumeViewport, getEnabledElement, Types as csTypes } from '@cornerstonejs/core';
import { AnnotationDisplayTool, drawing, utilities as csToolsUtils } from '@cornerstonejs/tools';

import { ARCH_COLOR, CURSOR_COLOR, NERVES, TOOL_NAME, Vec3 } from '../constants';
import { useDentalStore } from '../store/useDentalStore';
import { archPointAt, gridToWorld, nervePath, worldToGrid } from '../utils/archGeometry';
import { buildSeriesArch, resolveCursor } from '../utils/model';
import { getVolumeGrid, VolumeGrid } from '../utils/volumeGrid';

const { drawPolyline, drawHandles, drawLine, drawTextBox } = drawing;

const TOOL_GROUP_IDS = ['default', 'mpr'];

/** Serie dental que muestra un viewport: por volumeId en MPR, por imageId en stack. */
export function resolveSeriesForViewport(
  viewport: csTypes.IViewport
): { uid: string; grid: VolumeGrid } | null {
  const { bySeries } = useDentalStore.getState();
  const uids = Object.keys(bySeries).filter(uid => bySeries[uid].ready);
  if (!uids.length) {
    return null;
  }
  if (viewport instanceof BaseVolumeViewport) {
    const volumeId = (viewport as csTypes.IVolumeViewport).getVolumeId?.() ?? '';
    for (const uid of uids) {
      const grid = getVolumeGrid(uid);
      if (grid && volumeId.includes(uid)) {
        return { uid, grid };
      }
    }
    return null;
  }
  const imageId = (viewport as csTypes.IStackViewport).getCurrentImageId?.();
  if (!imageId) {
    return null;
  }
  for (const uid of uids) {
    const grid = getVolumeGrid(uid);
    if (grid && grid.imageIds.includes(imageId)) {
      return { uid, grid };
    }
  }
  return null;
}

let renderQueued = false;

/** Redibuja el arco en los viewports (agrupado: el store cambia en ráfagas al arrastrar). */
export function renderArch(): void {
  if (renderQueued) {
    return;
  }
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    try {
      csToolsUtils.triggerAnnotationRenderForToolGroupIds(TOOL_GROUP_IDS);
    } catch (error) {
      console.warn('DentalArchTool: no se pudo redibujar', error);
    }
  });
}

/**
 * Trazado del arco dental sobre un corte axial.
 *
 * Clic: añade un punto al final del arco; sobre la curva ya trazada lo inserta
 * ahí; sobre un punto existente lo arrastra. El arco vive en el store y es una
 * curva en el plano de los cortes: se dibuja proyectado en cualquier corte
 * axial, junto con las líneas de los cortes transversales y el canal.
 */
class DentalArchTool extends AnnotationDisplayTool {
  static toolName = TOOL_NAME;

  private drag: { uid: string; index: number } | null = null;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
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

  /** El plano del viewport es el de los cortes (el arco sólo tiene sentido ahí). */
  private isAxial(viewport: csTypes.IViewport, grid: VolumeGrid): boolean {
    const n = viewport.getCamera().viewPlaneNormal as Vec3;
    return Math.abs(n[0] * grid.normal[0] + n[1] * grid.normal[1] + n[2] * grid.normal[2]) > 0.98;
  }

  /** Lleva un punto del arco (en el plano a, b) al plano que muestra el viewport. */
  private projector(viewport: csTypes.IViewport, grid: VolumeGrid) {
    const c = worldToGrid(grid, viewport.getCamera().focalPoint as Vec3)[2];
    return (a: number, b: number) => viewport.worldToCanvas(gridToWorld(grid, [a, b, c]));
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
      return this.reject('Inicia la panorámica dental en esta serie desde el panel.');
    }
    const { uid, grid } = resolved;
    if (!this.isAxial(viewport, grid)) {
      return this.reject('El arco se traza sobre un corte axial.');
    }

    const store = useDentalStore.getState();
    const control = store.bySeries[uid].arch;
    const project = this.projector(viewport, grid);
    const canvas = currentPoints.canvas as csTypes.Point2;
    const hit = this.configuration.hitRadiusPx;

    let nearest = -1;
    let nearestD = hit;
    control.forEach((p, index) => {
      const g = worldToGrid(grid, p);
      const cp = project(g[0], g[1]);
      const d = Math.hypot(cp[0] - canvas[0], cp[1] - canvas[1]);
      if (d <= nearestD) {
        nearestD = d;
        nearest = index;
      }
    });
    if (nearest >= 0) {
      this.drag = { uid, index: nearest };
      return true;
    }

    const world = currentPoints.world as Vec3;
    const insertAt = this.insertIndex(control, grid, project, canvas);
    store.addArchPoint(uid, world, insertAt);
    this.drag = { uid, index: insertAt ?? control.length };
    return true;
  };

  /**
   * Si el clic cae sobre la curva ya trazada, índice donde insertar el punto
   * para refinarla; undefined = añadir al final.
   */
  private insertIndex(
    control: Vec3[],
    grid: VolumeGrid,
    project: (a: number, b: number) => csTypes.Point2,
    canvas: csTypes.Point2
  ): number | undefined {
    if (control.length < 2) {
      return undefined;
    }
    const arch = buildSeriesArch(grid, control);
    if (!arch) {
      return undefined;
    }
    let bestS = -1;
    let bestD = this.configuration.hitRadiusPx * 0.7;
    for (let i = 0; i < arch.count; i++) {
      const cp = project(arch.a[i], arch.b[i]);
      const d = Math.hypot(cp[0] - canvas[0], cp[1] - canvas[1]);
      if (d < bestD) {
        bestD = d;
        bestS = i * arch.stepMm;
      }
    }
    if (bestS < 0) {
      return undefined;
    }
    // Posición de cada punto de control sobre el arco, en el sentido del arco.
    const along = control.map(p => {
      const g = worldToGrid(grid, p);
      let s = 0;
      let dMin = Infinity;
      for (let i = 0; i < arch.count; i++) {
        const d = (g[0] - arch.a[i]) ** 2 + (g[1] - arch.b[i]) ** 2;
        if (d < dMin) {
          dMin = d;
          s = i * arch.stepMm;
        }
      }
      return s;
    });
    for (let i = 1; i < control.length; i++) {
      const lo = Math.min(along[i - 1], along[i]);
      const hi = Math.max(along[i - 1], along[i]);
      if (bestS > lo && bestS < hi) {
        return i;
      }
    }
    return undefined;
  }

  mouseDragCallback = (evt): void => {
    if (!this.drag) {
      return;
    }
    const { currentPoints } = evt.detail;
    useDentalStore
      .getState()
      .moveArchPoint(this.drag.uid, this.drag.index, currentPoints.world as Vec3);
  };

  mouseUpCallback = (): void => {
    this.drag = null;
  };

  // En pantalla táctil cornerstone llama a estos nombres; el detalle del evento
  // trae los mismos `currentPoints`.
  preTouchStartCallback = (evt): boolean => this.preMouseDownCallback(evt);
  touchDragCallback = (evt): void => this.mouseDragCallback(evt);
  touchEndCallback = (): void => this.mouseUpCallback();

  renderAnnotation = (enabledElement: csTypes.IEnabledElement, svgDrawingHelper): boolean => {
    const { viewport } = enabledElement;
    const resolved = resolveSeriesForViewport(viewport);
    if (!resolved) {
      return false;
    }
    const { uid, grid } = resolved;
    const dental = useDentalStore.getState();
    const series = dental.bySeries[uid];
    if (!series?.arch.length || !this.isAxial(viewport, grid)) {
      return false;
    }
    const project = this.projector(viewport, grid);
    const id = 'dental-arch';

    const handles = series.arch.map(p => {
      const g = worldToGrid(grid, p);
      return project(g[0], g[1]);
    });

    const arch = buildSeriesArch(grid, series.arch);
    if (arch) {
      const stride = Math.max(1, Math.round(1 / arch.stepMm));
      const curve: csTypes.Point2[] = [];
      const inner: csTypes.Point2[] = [];
      const outer: csTypes.Point2[] = [];
      const half = series.slabMm / 2;
      for (let i = 0; i < arch.count; i += stride) {
        curve.push(project(arch.a[i], arch.b[i]));
        if (half > 0) {
          outer.push(project(arch.a[i] + half * arch.na[i], arch.b[i] + half * arch.nb[i]));
          inner.push(project(arch.a[i] - half * arch.na[i], arch.b[i] - half * arch.nb[i]));
        }
      }
      // Los bordes del grosor de la panorámica, tenues.
      [outer, inner].forEach((edge, n) => {
        if (edge.length > 1) {
          drawPolyline(svgDrawingHelper, id, `slab-${n}`, edge, {
            color: 'rgba(125, 211, 252, 0.35)',
            lineWidth: 1,
            lineDash: '2,4',
          });
        }
      });
      drawPolyline(svgDrawingHelper, id, 'curve', curve, { color: ARCH_COLOR, lineWidth: 1.5 });

      // Cortes transversales, los mismos que muestra la franja (sólo el del
      // cursor si está oculta): el del cursor resaltado y numerado.
      const cursorS = resolveCursor(arch, series.cursorS);
      const halfWidth = series.sectionWidthMm / 2;
      const count = dental.dockOpen && dental.activeUid === uid ? dental.sectionCount : 1;
      for (let m = -Math.floor(count / 2); m <= Math.floor(count / 2); m++) {
        const s = cursorS + m * series.sectionSpacingMm;
        if (s < 0 || s > arch.lengthMm) {
          continue;
        }
        const p = archPointAt(arch, s);
        const from = project(p.a + halfWidth * p.na, p.b + halfWidth * p.nb);
        const to = project(p.a - halfWidth * p.na, p.b - halfWidth * p.nb);
        const isCursor = m === 0;
        drawLine(svgDrawingHelper, id, `section-${m}`, from, to, {
          color: isCursor ? CURSOR_COLOR : 'rgba(167, 243, 208, 0.35)',
          width: isCursor ? 1.5 : 1,
        });
        if (isCursor) {
          drawTextBox(
            svgDrawingHelper,
            id,
            'section-label',
            [String(Math.round(s / series.sectionSpacingMm))],
            [from[0] + 4, from[1] - 14],
            { color: CURSOR_COLOR, fontSize: '11px', padding: 2 }
          );
        }
      }

      NERVES.forEach(nerve => {
        const path = nervePath(arch, grid, series.nerves[nerve.id]);
        if (path.length < 2) {
          return;
        }
        const points = path.map(p => {
          const at = archPointAt(arch, p.s);
          return project(at.a + p.o * at.na, at.b + p.o * at.nb);
        });
        drawPolyline(svgDrawingHelper, id, `nerve-${nerve.id}`, points, {
          color: nerve.color,
          lineWidth: 1.5,
        });
      });
    } else if (handles.length > 1) {
      drawPolyline(svgDrawingHelper, id, 'curve', handles, {
        color: ARCH_COLOR,
        lineWidth: 1,
        lineDash: '3,3',
      });
    }

    drawHandles(svgDrawingHelper, id, 'handles', handles, {
      color: ARCH_COLOR,
      fill: ARCH_COLOR,
      handleRadius: this.configuration.handleRadiusPx,
    });
    return true;
  };
}

export default DentalArchTool;
