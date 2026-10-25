import { Enums as csEnums, getRenderingEngine, metaData, type Types } from '@cornerstonejs/core';
import { SynchronizerManager } from '@cornerstonejs/tools';

import {
  classifyMammoDisplaySet,
  displayFlips,
  innerCanvasSide,
  type MammoImageFrame,
  type MammoView,
  mirrorImagePoint,
  chestWallImageSide,
} from './mammoGeometry';
import {
  MAMMO_MIRROR_PROTOCOL_ID,
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

/**
 * Presentación inicial: imagen completa, volteada si hace falta, con la pared
 * torácica pegada al borde del viewport que da al centro de la pantalla. Se
 * guarda como cámara inicial.
 */
function placeMammoViewport(viewport: StackLike, mammoView: MammoView) {
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
    if (!frame) {
      return;
    }
    const wallColumn = frame.chestWall === 'right' ? frame.columns - 0.5 : -0.5;
    const wallWorld = viewport
      .getImageData()
      .imageData.indexToWorld([wallColumn, frame.rows / 2 - 0.5, 0], []) as Types.Point3;
    const [x, y] = viewport.worldToCanvas(wallWorld);
    const targetX =
      innerCanvasSide(mammoView.laterality) === 'right' ? viewport.canvas.clientWidth : 0;

    const from = viewport.canvasToWorld([x, y]);
    const to = viewport.canvasToWorld([targetX, y]);
    const delta = from.map((value, i) => value - to[i]);

    const camera = viewport.getCamera();
    viewport.setCamera(
      {
        focalPoint: camera.focalPoint.map((value, i) => value + delta[i]) as Types.Point3,
        position: camera.position.map((value, i) => value + delta[i]) as Types.Point3,
      },
      true
    );
    viewport.render();
  } finally {
    placing.delete(viewport.element);
  }
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

  const withReset = new WeakSet<HTMLDivElement>();

  cornerstoneViewportService.subscribe(
    cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
    ({ viewportId }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId) as StackLike;
      const mammoView = mammoViewFor(viewportId);
      if (!viewport?.getImageData || !mammoView) {
        return;
      }
      placeMammoViewport(viewport, mammoView);

      const element = viewport.element;
      if (withReset.has(element)) {
        return;
      }
      withReset.add(element);
      element.addEventListener(csEnums.Events.CAMERA_RESET, () => {
        const current = cornerstoneViewportService.getCornerstoneViewport(viewportId) as StackLike;
        const view = mammoViewFor(viewportId);
        if (current?.element === element && view) {
          placeMammoViewport(current, view);
        }
      });
    }
  );
}
