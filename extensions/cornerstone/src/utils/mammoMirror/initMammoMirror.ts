import {
  cache,
  Enums as csEnums,
  getRenderingEngine,
  metaData,
  type Types,
} from '@cornerstonejs/core';
import { SynchronizerManager } from '@cornerstonejs/tools';

import {
  anatomicalToImage,
  cameraForFraming,
  chestWallImageSide,
  classifyMammoDisplaySet,
  displayFlips,
  findTissueBounds,
  framingFromBounds,
  innerCanvasSide,
  type MammoFraming,
  type MammoImageFrame,
  type MammoTissueBounds,
  type MammoView,
  mirrorImagePoint,
  unionFraming,
} from './mammoGeometry';
import {
  MAMMO_MIRROR_PROTOCOL_ID,
  MAMMO_VIEWPORT_RESET_EVENT,
  MAMMO_MIRROR_SYNC_TYPE,
  MAMMO_VIEW_ATTRIBUTE,
  MAMMO_VIEW_COUNT_ATTRIBUTE,
} from './hpMammoMirror';

type StackLike = Types.IStackViewport;

function instanceOf(viewport: StackLike) {
  const imageId = viewport.getCurrentImageId?.();
  return imageId ? metaData.get('instance', imageId) : undefined;
}

/** Marco de la imagen que muestra el viewport, o undefined si aún no hay imagen. */
function getFrame(viewport: StackLike): MammoImageFrame | undefined {
  const imageData = viewport.getImageData?.();
  const instance = instanceOf(viewport);
  const chestWall = chestWallImageSide(instance?.PatientOrientation);
  if (!imageData?.imageData || !chestWall) {
    return;
  }
  const [columns, rows] = imageData.dimensions;
  const [columnSpacing, rowSpacing] = imageData.spacing;
  return {
    columns,
    rows,
    columnSpacing,
    rowSpacing,
    chestWall,
    flipVertical: Boolean(viewport.getCamera().flipVertical),
  };
}

/**
 * Lleva el centro de la vista del viewport de origen al punto simétrico del de
 * destino, con la misma escala en mm por píxel de pantalla. Sólo actúa entre
 * una mama derecha y una izquierda; si el usuario arrastró otra serie a uno de
 * los dos, no hace nada.
 */
function mammoMirrorCallback(_synchronizer, sourceRef, targetRef) {
  const renderingEngine = getRenderingEngine(targetRef.renderingEngineId);
  const source = renderingEngine?.getViewport(sourceRef.viewportId) as StackLike;
  const target = renderingEngine?.getViewport(targetRef.viewportId) as StackLike;
  if (!source?.getImageData || !target?.getImageData) {
    return;
  }

  const sourceLaterality = instanceOf(source)?.ImageLaterality;
  const targetLaterality = instanceOf(target)?.ImageLaterality;
  if (!sourceLaterality || !targetLaterality || sourceLaterality === targetLaterality) {
    return;
  }

  const sourceFrame = getFrame(source);
  const targetFrame = getFrame(target);
  if (!sourceFrame || !targetFrame) {
    return;
  }

  const sourceCamera = source.getCamera();
  const targetCamera = target.getCamera();
  const sourceIndex = source.getImageData().imageData.worldToIndex(sourceCamera.focalPoint, []);
  const [column, row] = mirrorImagePoint(sourceFrame, targetFrame, sourceIndex);
  const focalPoint = target.getImageData().imageData.indexToWorld([column, row, 0], []);

  const delta = focalPoint.map((value, i) => value - targetCamera.focalPoint[i]);
  const position = targetCamera.position.map((value, i) => value + delta[i]) as Types.Point3;

  const sourceHeight = source.canvas.clientHeight || 1;
  const targetHeight = target.canvas.clientHeight || 1;

  target.setCamera({
    focalPoint: focalPoint as Types.Point3,
    position,
    parallelScale: (sourceCamera.parallelScale * targetHeight) / sourceHeight,
  });
  target.render();
}

function createMammoMirrorSynchronizer(id: string) {
  return SynchronizerManager.createSynchronizer(
    id,
    csEnums.Events.CAMERA_MODIFIED,
    mammoMirrorCallback
  );
}

const placing = new WeakSet<HTMLDivElement>();

/** Límites del tejido por imagen; se calculan una vez (la imagen no cambia). */
const boundsByImageId = new Map<string, MammoTissueBounds | null>();

function tissueBounds(viewport: StackLike, frame: MammoImageFrame) {
  const imageId = viewport.getCurrentImageId?.();
  if (!imageId) {
    return;
  }
  if (!boundsByImageId.has(imageId)) {
    const pixels = cache.getImage(imageId)?.getPixelData?.();
    if (!pixels) {
      // Todavía sin píxeles: se encuadra la imagen completa y se reintenta luego.
      return;
    }
    boundsByImageId.set(
      imageId,
      findTissueBounds(pixels, frame.columns, frame.rows, frame.chestWall) ?? null
    );
  }
  return boundsByImageId.get(imageId) ?? undefined;
}

function framingOf(viewport: StackLike): MammoFraming | undefined {
  const frame = getFrame(viewport);
  return frame ? framingFromBounds(frame, tissueBounds(viewport, frame)) : undefined;
}

/**
 * Presentación inicial: volteada si hace falta, con la pared torácica pegada
 * al borde del viewport que da al centro de la pantalla y la mama (no la
 * imagen completa) llenando la vista. Las dos mamas del par usan el mismo
 * marco, así que quedan a la misma escala. Se guarda como cámara inicial.
 */
function placeMammoViewport(viewport: StackLike, mammoView: MammoView, partner?: StackLike) {
  const instance = instanceOf(viewport);
  const flips = displayFlips(mammoView, instance?.PatientOrientation);
  if (!flips || placing.has(viewport.element)) {
    return;
  }

  placing.add(viewport.element);
  try {
    viewport.resetCamera();
    if (flips.flipHorizontal || flips.flipVertical) {
      viewport.setCamera(flips);
    }

    const frame = getFrame(viewport);
    const ownFraming = framingOf(viewport);
    if (!frame || !ownFraming) {
      return;
    }
    const framing = unionFraming(ownFraming, partner ? framingOf(partner) : undefined);
    const { clientWidth, clientHeight } = viewport.canvas;
    const { parallelScale, center } = cameraForFraming(framing, clientWidth, clientHeight);
    const [column, row] = anatomicalToImage(frame, center);
    const focalPoint = viewport
      .getImageData()
      .imageData.indexToWorld([column - 0.5, row - 0.5, 0], []) as Types.Point3;

    const camera = viewport.getCamera();
    const delta = focalPoint.map((value, i) => value - camera.focalPoint[i]);
    viewport.setCamera(
      {
        focalPoint,
        position: camera.position.map((value, i) => value + delta[i]) as Types.Point3,
        parallelScale,
      },
      true
    );
    viewport.render();
  } finally {
    placing.delete(viewport.element);
  }
}

/** Punto del mundo en el borde interior (el de la pared), a media altura. */
function innerEdgeWorld(viewport: StackLike, laterality: MammoView['laterality']) {
  const { clientWidth, clientHeight } = viewport.canvas;
  const x = innerCanvasSide(laterality) === 'right' ? clientWidth : 0;
  return viewport.canvasToWorld([x, clientHeight / 2]);
}

/**
 * NUBIX: lectura en espejo de mamografía 2D. Registra los atributos con que el
 * protocolo reconoce las proyecciones, el sincronizador en espejo y la
 * colocación inicial de cada imagen (también tras "Restablecer").
 */
export default function initMammoMirror({ servicesManager }: withAppTypes) {
  const {
    hangingProtocolService,
    syncGroupService,
    cornerstoneViewportService,
    displaySetService,
    viewportGridService,
  } = servicesManager.services;

  hangingProtocolService.addCustomAttribute(
    MAMMO_VIEW_ATTRIBUTE,
    'Proyección de mamografía 2D (RCC, LCC, RMLO, LMLO)',
    displaySet => classifyMammoDisplaySet(displaySet)?.code
  );
  hangingProtocolService.addCustomAttribute(
    MAMMO_VIEW_COUNT_ATTRIBUTE,
    'Número de proyecciones de mamografía 2D distintas en el estudio',
    (study, options) => {
      const displaySets = (options?.displaySets as unknown[]) ?? [];
      const codes = displaySets
        .filter((ds: AppTypes.DisplaySet) => ds.StudyInstanceUID === study?.StudyInstanceUID)
        .map(ds => classifyMammoDisplaySet(ds)?.code)
        .filter(Boolean);
      return new Set(codes).size;
    }
  );

  syncGroupService.addSynchronizerType(MAMMO_MIRROR_SYNC_TYPE, createMammoMirrorSynchronizer);

  const mammoViewFor = (viewportId: string): MammoView | undefined => {
    if (hangingProtocolService.getActiveProtocol()?.protocol?.id !== MAMMO_MIRROR_PROTOCOL_ID) {
      return;
    }
    const [displaySetInstanceUID] =
      viewportGridService.getDisplaySetsUIDsForViewport(viewportId) ?? [];
    return classifyMammoDisplaySet(displaySetService.getDisplaySetByUID(displaySetInstanceUID));
  };

  /** La otra mama de la misma proyección, si está en pantalla. */
  const partnerOf = (viewportId: string, mammoView: MammoView): StackLike | undefined => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const engine = viewport && getRenderingEngine(viewport.renderingEngineId);
    return engine?.getViewports().find(other => {
      if (other.id === viewportId) {
        return false;
      }
      const view = mammoViewFor(other.id);
      return view && view.view === mammoView.view && view.laterality !== mammoView.laterality;
    }) as StackLike | undefined;
  };

  /** Tamaño del canvas, cámara y punto del borde interior en la última vista. */
  type EdgeState = {
    width: number;
    height: number;
    edge: Types.Point3;
    focalPoint: Types.Point3;
    position: Types.Point3;
    parallelScale: number;
  };
  const lastEdge = new WeakMap<HTMLDivElement, EdgeState>();
  /** Cámara recién colocada; si sigue igual, el usuario no ha movido nada. */
  const placedCamera = new WeakMap<
    HTMLDivElement,
    { focalPoint: number[]; parallelScale: number }
  >();
  const isUntouched = (element: HTMLDivElement, state: EdgeState) => {
    const placed = placedCamera.get(element);
    return (
      !!placed &&
      Math.abs(placed.parallelScale - state.parallelScale) < 1e-3 * placed.parallelScale &&
      placed.focalPoint.every((v, i) => Math.abs(v - state.focalPoint[i]) < 1e-3)
    );
  };
  const pendingResize = new WeakSet<HTMLDivElement>();
  const rememberEdge = (viewport: StackLike, mammoView: MammoView) => {
    const { clientWidth: width, clientHeight: height } = viewport.canvas;
    if (width && height) {
      const { focalPoint, position, parallelScale } = viewport.getCamera();
      lastEdge.set(viewport.element, {
        width,
        height,
        edge: innerEdgeWorld(viewport, mammoView.laterality),
        focalPoint,
        position,
        parallelScale,
      });
    }
  };

  const place = (viewportId: string) => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId) as StackLike;
    const mammoView = mammoViewFor(viewportId);
    if (!viewport?.getImageData || !mammoView) {
      return;
    }
    placeMammoViewport(viewport, mammoView, partnerOf(viewportId, mammoView));
    const { focalPoint, parallelScale } = viewport.getCamera();
    placedCamera.set(viewport.element, { focalPoint: [...focalPoint], parallelScale });
    rememberEdge(viewport, mammoView);
  };

  const watched = new WeakSet<HTMLDivElement>();

  /**
   * Al cambiar el tamaño del viewport (ocultar un panel, girar el teléfono)
   * cornerstone conserva el centro y OHIF recalcula zoom y desplazamiento
   * respecto de la imagen completa, así que el encuadre se perdía y la pared
   * torácica se despegaba del borde. Se reconoce el cambio porque llega un
   * CAMERA_MODIFIED con el canvas de otro tamaño; cuando OHIF termina (es
   * síncrono, así que basta un setTimeout) se restaura la cámara de antes con
   * la misma escala en mm por píxel y se lleva el punto que estaba en el borde
   * interior de vuelta a ese borde.
   */
  const watch = (viewportId: string, element: HTMLDivElement) => {
    if (watched.has(element)) {
      return;
    }
    watched.add(element);

    const restoreAfterResize = () => {
      pendingResize.delete(element);
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId) as StackLike;
      const mammoView = mammoViewFor(viewportId);
      const before = lastEdge.get(element);
      if (viewport?.element !== element || !mammoView || !before) {
        return;
      }
      // Sin tocar desde la colocación (o colocada antes de que el canvas
      // tuviera su tamaño final, como al cambiar de etapa): encuadrar de nuevo.
      if (isUntouched(element, before)) {
        place(viewportId);
        return;
      }
      const { clientHeight: height } = viewport.canvas;
      placing.add(element);
      try {
        viewport.setCamera({
          focalPoint: before.focalPoint,
          position: before.position,
          parallelScale: (before.parallelScale * height) / before.height,
        });
        const edge = innerEdgeWorld(viewport, mammoView.laterality);
        const delta = before.edge.map((value, i) => value - edge[i]);
        viewport.setCamera({
          focalPoint: before.focalPoint.map((v, i) => v + delta[i]) as Types.Point3,
          position: before.position.map((v, i) => v + delta[i]) as Types.Point3,
        });
      } finally {
        placing.delete(element);
      }
      rememberEdge(viewport, mammoView);
      // Un último setCamera fuera de `placing` para que el espejo lo copie.
      viewport.setCamera(viewport.getCamera());
      viewport.render();
    };

    element.addEventListener(csEnums.Events.CAMERA_MODIFIED, () => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId) as StackLike;
      const mammoView = mammoViewFor(viewportId);
      if (viewport?.element !== element || !mammoView) {
        lastEdge.delete(element);
        return;
      }
      if (placing.has(element) || pendingResize.has(element)) {
        return;
      }
      const { clientWidth: width, clientHeight: height } = viewport.canvas;
      if (!width || !height) {
        return;
      }
      const last = lastEdge.get(element);
      if (last && (last.width !== width || last.height !== height)) {
        pendingResize.add(element);
        setTimeout(restoreAfterResize, 0);
        return;
      }
      rememberEdge(viewport, mammoView);
    });

    // "Restablecer" (commandsModule) avisa con este evento: cornerstone sólo
    // emite CAMERA_RESET en los viewports de volumen, no en los stack.
    element.addEventListener(MAMMO_VIEWPORT_RESET_EVENT, () => {
      const current = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (current?.element === element) {
        place(viewportId);
      }
    });
  };

  cornerstoneViewportService.subscribe(
    cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
    ({ viewportId }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId) as StackLike;
      if (!viewport?.getImageData || !mammoViewFor(viewportId)) {
        return;
      }
      place(viewportId);
      watch(viewportId, viewport.element);
    }
  );
}
