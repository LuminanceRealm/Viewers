import React, { useCallback, useEffect, useRef, useState } from 'react';
// Registra el override OpenGL del mapper CPR; sin este import no se dibuja nada.
import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ROTATION_STEP_DEG, Vec3 } from '../constants';
import type { CprMode } from '../store/useCprStore';
import { buildCenterlinePolyData, OrientedCenterline } from '../utils/buildCenterlinePolyData';

export interface CprViewProps {
  imageData: vtkImageData | null;
  centerline: OrientedCenterline | null;
  widthMm: number;
  mode: CprMode;
  window: number;
  level: number;
  cursorDistance: number | null;
  onPick?: (distance: number, world: Vec3) => void;
  onWindowLevel?: (window: number, level: number) => void;
  onRotate?: (deltaDeg: number) => void;
  onError?: (message: string) => void;
}

interface CameraLayout {
  /** Altura del CPR en mm (distancia total de la centerline). */
  heightMm: number;
  /** Medio alto visible en unidades de modelo. */
  parallelScale: number;
  cssHeight: number;
}

export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Tira CPR: un `vtkImageSlice` con `vtkImageCPRMapper` en un render window
 * propio de vtk.js, independiente del motor de cornerstone. El plano del actor
 * ocupa x ∈ [0, ancho], y ∈ [0, alto] con el primer punto de la centerline
 * arriba; la cámara es paralela y se encuadra para que quepa todo.
 */
export default function CprView(props: CprViewProps) {
  const {
    imageData,
    centerline,
    widthMm,
    mode,
    window: colorWindow,
    level: colorLevel,
    cursorDistance,
    onPick,
    onWindowLevel,
    onRotate,
    onError,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const grwRef = useRef<ReturnType<typeof vtkGenericRenderWindow.newInstance> | null>(null);
  const actorRef = useRef<ReturnType<typeof vtkImageSlice.newInstance> | null>(null);
  const mapperRef = useRef<ReturnType<typeof vtkImageCPRMapper.newInstance> | null>(null);
  const actorAddedRef = useRef(false);
  const [layout, setLayout] = useState<CameraLayout | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  const dragRef = useRef<{
    x: number;
    y: number;
    window: number;
    level: number;
    moved: boolean;
  } | null>(null);

  const render = useCallback(() => {
    grwRef.current?.getRenderWindow().render();
  }, []);

  const fitCamera = useCallback(() => {
    const grw = grwRef.current;
    const mapper = mapperRef.current;
    const container = containerRef.current;
    if (!grw || !mapper || !container || !actorAddedRef.current) {
      return;
    }
    const w = mapper.getWidth();
    const h = mapper.getHeight();
    if (!(w > 0) || !(h > 0)) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    const parallelScale = Math.max(h / 2, w / (2 * aspect));

    const camera = grw.getRenderer().getActiveCamera();
    camera.setParallelProjection(true);
    camera.setFocalPoint(w / 2, h / 2, 0);
    camera.setPosition(w / 2, h / 2, 1);
    camera.setViewUp(0, 1, 0);
    camera.setParallelScale(parallelScale);
    camera.setClippingRange(0.01, 2);

    setLayout({ heightMm: h, parallelScale, cssHeight: rect.height });
  }, []);

  // Montaje del render window.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (!hasWebGL2()) {
      const message = 'Este navegador no tiene WebGL2; la vista CPR no está disponible.';
      setUnsupported(message);
      onError?.(message);
      return;
    }

    const grw = vtkGenericRenderWindow.newInstance({
      background: [0, 0, 0],
      listenWindowResize: false,
    });
    grw.setContainer(container);
    // Sin estilo de interacción de vtk: los gestos los maneja este componente.
    grw.getInteractor().setInteractorStyle(null);

    const mapper = vtkImageCPRMapper.newInstance();
    const actor = vtkImageSlice.newInstance();
    actor.setMapper(mapper);
    actor.getProperty().setColorWindow(colorWindow);
    actor.getProperty().setColorLevel(colorLevel);

    grwRef.current = grw;
    mapperRef.current = mapper;
    actorRef.current = actor;

    const observer = new ResizeObserver(() => {
      grw.resize();
      fitCamera();
      render();
    });
    observer.observe(container);
    grw.resize();

    return () => {
      observer.disconnect();
      grwRef.current = null;
      mapperRef.current = null;
      actorRef.current = null;
      actorAddedRef.current = false;
      try {
        grw.getRenderer().removeAllViewProps();
        grw.setContainer(null as unknown as HTMLElement);
        grw.delete();
      } catch (error) {
        console.warn('CprView: error al liberar el render window', error);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Datos: volumen recortado + centerline + ancho + modo.
  useEffect(() => {
    const grw = grwRef.current;
    const mapper = mapperRef.current;
    const actor = actorRef.current;
    if (!grw || !mapper || !actor) {
      return;
    }
    const renderer = grw.getRenderer();

    if (!imageData || !centerline) {
      if (actorAddedRef.current) {
        renderer.removeActor(actor);
        actorAddedRef.current = false;
      }
      setLayout(null);
      render();
      return;
    }

    try {
      mapper.setImageData(imageData);
      mapper.setCenterlineData(buildCenterlinePolyData(centerline));
      mapper.setWidth(widthMm);
      if (mode === 'stretched') {
        mapper.setUniformOrientation(Array.from(centerline.orientations.subarray(0, 4)));
        mapper.useStretchedMode();
      } else {
        mapper.useStraightenedMode();
      }
      if (!actorAddedRef.current) {
        renderer.addActor(actor);
        actorAddedRef.current = true;
      }
      fitCamera();
      render();
    } catch (error) {
      console.error('CprView: no se pudo actualizar el CPR', error);
      onError?.(`No se pudo dibujar el CPR: ${(error as Error).message}`);
    }
  }, [imageData, centerline, widthMm, mode, fitCamera, render, onError]);

  // Ventana.
  useEffect(() => {
    const actor = actorRef.current;
    if (!actor) {
      return;
    }
    actor.getProperty().setColorWindow(colorWindow);
    actor.getProperty().setColorLevel(colorLevel);
    render();
  }, [colorWindow, colorLevel, render]);

  // --- Interacción ---------------------------------------------------------

  const distanceAtClientY = useCallback(
    (clientY: number): number | null => {
      const container = containerRef.current;
      if (!container || !layout) {
        return null;
      }
      const rect = container.getBoundingClientRect();
      const t = (clientY - rect.top) / rect.height; // 0 arriba, 1 abajo
      const yModel = layout.heightMm / 2 + (0.5 - t) * 2 * layout.parallelScale;
      const distance = layout.heightMm - yModel;
      if (distance < 0 || distance > layout.heightMm) {
        return null;
      }
      return distance;
    },
    [layout]
  );

  const cursorTop = (() => {
    if (cursorDistance === null || !layout) {
      return null;
    }
    const yModel = layout.heightMm - cursorDistance;
    const t = 0.5 - (yModel - layout.heightMm / 2) / (2 * layout.parallelScale);
    return `${(t * 100).toFixed(3)}%`;
  })();

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) {
      return;
    }
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      window: colorWindow,
      level: colorLevel,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) {
      return;
    }
    drag.moved = true;
    onWindowLevel?.(Math.max(1, drag.window + dx * 4), drag.level - dy * 4);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) {
      return;
    }
    const distance = distanceAtClientY(e.clientY);
    const mapper = mapperRef.current;
    if (distance === null || !mapper || !onPick) {
      return;
    }
    const { position } = mapper.getCenterlinePositionAndOrientation(distance);
    if (position) {
      onPick(distance, [position[0], position[1], position[2]]);
    }
  };

  // La rueda se registra a mano para poder hacer preventDefault (React la marca pasiva).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) {
        return;
      }
      onRotate?.(e.deltaY > 0 ? ROTATION_STEP_DEG : -ROTATION_STEP_DEG);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [onRotate]);

  if (unsupported) {
    return (
      <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-amber-400">
        {unsupported}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black">
      <div
        ref={containerRef}
        className="h-full w-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragRef.current = null;
        }}
      />
      {layout && (
        <>
          <div className="pointer-events-none absolute top-1 left-1 text-[10px] text-white/60">
            0 mm
          </div>
          <div className="pointer-events-none absolute bottom-1 left-1 text-[10px] text-white/60">
            {layout.heightMm.toFixed(0)} mm
          </div>
        </>
      )}
      {cursorTop !== null && (
        <div
          className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-cyan-300/80"
          style={{ top: cursorTop }}
        />
      )}
    </div>
  );
}
