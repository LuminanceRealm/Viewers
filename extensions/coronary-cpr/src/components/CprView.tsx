import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
// Registra el override OpenGL del mapper CPR; sin este import no se dibuja nada.
import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ROTATION_STEP_DEG, Vec3, arteryCss, arteryById } from '../constants';
import type { CprMode, MeasureMode } from '../store/useCprStore';
import { buildCenterlinePolyData, OrientedCenterline } from '../utils/buildCenterlinePolyData';
import {
  CprMeasurement,
  lengthMm,
  projectToStrip,
  stenosis,
  StripGeometry,
  stripToWorld,
} from '../utils/measurements';

export interface CprViewProps {
  imageData: vtkImageData | null;
  centerline: OrientedCenterline | null;
  widthMm: number;
  mode: CprMode;
  window: number;
  level: number;
  cursorDistance: number | null;
  measurements?: CprMeasurement[];
  measureMode?: MeasureMode;
  pendingPoints?: Vec3[];
  onPick?: (distance: number, world: Vec3) => void;
  onMeasurePoint?: (world: Vec3) => void;
  onWindowLevel?: (window: number, level: number) => void;
  onRotate?: (deltaDeg: number) => void;
  onError?: (message: string) => void;
}

interface CameraLayout {
  /** Altura del CPR en mm (distancia total de la centerline). */
  heightMm: number;
  widthMm: number;
  /** Medio alto visible en unidades de modelo. */
  parallelScale: number;
  cssWidth: number;
  cssHeight: number;
}

/** Más allá de esto un punto de medición se dibuja atenuado por estar fuera del plano. */
const OFF_PLANE_DIM_MM = 1.5;

export interface CprViewHandle {
  /** PNG (data URL) de la tira con las mediciones encima, o null si no hay imagen. */
  captureStrip: () => Promise<string | null>;
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
 * arriba; la cámara es paralela y se encuadra para que quepa todo. Las
 * mediciones viven en coordenadas mundo y se proyectan sobre la tira en cada
 * render, así siguen a la anatomía al girar o cambiar el ancho.
 */
const CprView = forwardRef<CprViewHandle, CprViewProps>(function CprView(props, ref) {
  const {
    imageData,
    centerline,
    widthMm,
    mode,
    window: colorWindow,
    level: colorLevel,
    cursorDistance,
    measurements = [],
    measureMode = 'none',
    pendingPoints = [],
    onPick,
    onMeasurePoint,
    onWindowLevel,
    onRotate,
    onError,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const grwRef = useRef<ReturnType<typeof vtkGenericRenderWindow.newInstance> | null>(null);
  const actorRef = useRef<ReturnType<typeof vtkImageSlice.newInstance> | null>(null);
  const mapperRef = useRef<ReturnType<typeof vtkImageCPRMapper.newInstance> | null>(null);
  const actorAddedRef = useRef(false);
  const [layout, setLayout] = useState<CameraLayout | null>(null);
  const [stripGeometry, setStripGeometry] = useState<StripGeometry | null>(null);
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

    setLayout({
      heightMm: h,
      widthMm: w,
      parallelScale,
      cssWidth: rect.width,
      cssHeight: rect.height,
    });
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
      setStripGeometry(null);
      render();
      return;
    }

    try {
      mapper.setImageData(imageData);
      mapper.setCenterlineData(buildCenterlinePolyData(centerline));
      mapper.setWidth(widthMm);
      let uniformOrientation: [number, number, number, number] | null = null;
      if (mode === 'stretched') {
        uniformOrientation = Array.from(centerline.orientations.subarray(0, 4)) as [
          number,
          number,
          number,
          number,
        ];
        mapper.setUniformOrientation(uniformOrientation);
        mapper.useStretchedMode();
      } else {
        mapper.useStraightenedMode();
      }
      if (!actorAddedRef.current) {
        renderer.addActor(actor);
        actorAddedRef.current = true;
      }
      // Distancias con la métrica del modo actual, para proyectar mediciones.
      const distances = Array.from(mapper.getOrientedCenterline().getDistancesToFirstPoint());
      setStripGeometry({
        points: centerline.points,
        orientations: centerline.orientations,
        distances,
        uniformOrientation,
      });
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

  // --- Conversión tira ↔ pantalla --------------------------------------------

  /** Coordenadas de modelo (x ∈ [0,w], y ∈ [0,h]) de un punto de pantalla. */
  const modelAtClient = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const container = containerRef.current;
      if (!container || !layout) {
        return null;
      }
      const rect = container.getBoundingClientRect();
      const aspect = rect.width / Math.max(rect.height, 1);
      const tx = (clientX - rect.left) / rect.width - 0.5;
      const ty = 0.5 - (clientY - rect.top) / rect.height;
      return {
        x: layout.widthMm / 2 + tx * 2 * layout.parallelScale * aspect,
        y: layout.heightMm / 2 + ty * 2 * layout.parallelScale,
      };
    },
    [layout]
  );

  /** Posición CSS (px dentro del contenedor) de un punto de la tira. */
  const cssOfStrip = useCallback(
    (distance: number, lateral: number): { left: number; top: number } | null => {
      if (!layout) {
        return null;
      }
      const aspect = layout.cssWidth / Math.max(layout.cssHeight, 1);
      const yModel = layout.heightMm - distance;
      const tx = lateral / (2 * layout.parallelScale * aspect);
      const ty = (yModel - layout.heightMm / 2) / (2 * layout.parallelScale);
      return {
        left: (0.5 + tx) * layout.cssWidth,
        top: (0.5 - ty) * layout.cssHeight,
      };
    },
    [layout]
  );

  const worldAtClient = useCallback(
    (clientX: number, clientY: number): { world: Vec3; distance: number } | null => {
      const mapper = mapperRef.current;
      const model = modelAtClient(clientX, clientY);
      if (!mapper || !model || !layout) {
        return null;
      }
      const distance = layout.heightMm - model.y;
      if (distance < 0 || distance > layout.heightMm) {
        return null;
      }
      const { position, orientation } = mapper.getCenterlinePositionAndOrientation(distance);
      if (!position) {
        return null;
      }
      const quat = (stripGeometry?.uniformOrientation ??
        (orientation ? Array.from(orientation) : [0, 0, 0, 1])) as [number, number, number, number];
      const lateral = model.x - layout.widthMm / 2;
      return {
        world: stripToWorld([position[0], position[1], position[2]], quat, lateral),
        distance,
      };
    },
    [modelAtClient, layout, stripGeometry]
  );

  const cursorTop = (() => {
    if (cursorDistance === null || !layout) {
      return null;
    }
    const css = cssOfStrip(cursorDistance, 0);
    return css ? `${css.top}px` : null;
  })();

  // Mediciones proyectadas sobre la tira.
  const overlay = useMemo(() => {
    if (!stripGeometry || !layout) {
      return { items: [], pending: [] as { left: number; top: number }[] };
    }
    const project = (p: Vec3) => {
      const strip = projectToStrip(p, stripGeometry);
      if (!strip) {
        return null;
      }
      const css = cssOfStrip(strip.distance, strip.lateral);
      return css ? { ...css, offPlane: strip.offPlane } : null;
    };
    const items = measurements
      .map(m => {
        const pts = m.points.map(project);
        if (pts.some(p => !p)) {
          return null;
        }
        const dim = pts.some(p => (p as { offPlane: number }).offPlane > OFF_PLANE_DIM_MM);
        const color = arteryCss(arteryById(m.arteryId)?.color ?? [200, 200, 200, 255]);
        let label = '';
        if (m.kind === 'length') {
          const l = lengthMm(m.points);
          label = l === null ? '' : `${l.toFixed(1)} mm`;
        } else {
          const s = stenosis(m.points);
          label = s?.percent === null || !s ? '' : `${s.percent.toFixed(0)} %`;
        }
        return {
          id: m.id,
          kind: m.kind,
          points: pts as { left: number; top: number }[],
          dim,
          color,
          label,
        };
      })
      .filter(Boolean) as {
      id: number;
      kind: string;
      points: { left: number; top: number }[];
      dim: boolean;
      color: string;
      label: string;
    }[];
    const pending = pendingPoints.map(project).filter(Boolean) as { left: number; top: number }[];
    return { items, pending };
  }, [measurements, pendingPoints, stripGeometry, layout, cssOfStrip]);

  // --- Interacción ---------------------------------------------------------

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
    const hit = worldAtClient(e.clientX, e.clientY);
    if (!hit) {
      return;
    }
    if (measureMode !== 'none') {
      onMeasurePoint?.(hit.world);
      return;
    }
    onPick?.(hit.distance, hit.world);
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

  useImperativeHandle(
    ref,
    () => ({
      captureStrip: async () => {
        const grw = grwRef.current;
        if (!grw || !actorAddedRef.current || !layout) {
          return null;
        }
        // El canvas WebGL no conserva el buffer: hay que capturar justo tras un render.
        const glWindow = grw.getApiSpecificRenderWindow() as unknown as {
          captureNextImage: (format: string) => Promise<string>;
        };
        const pending = glWindow.captureNextImage('image/png');
        grw.getRenderWindow().render();
        const base = await pending;

        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(layout.cssWidth * scale);
        canvas.height = Math.round(layout.cssHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return base;
        }
        const draw = (src: string) =>
          new Promise<void>(resolve => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = src;
          });
        await draw(base);
        const svg = overlayRef.current;
        if (svg) {
          const clone = svg.cloneNode(true) as SVGSVGElement;
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const markup = new XMLSerializer().serializeToString(clone);
          const url = URL.createObjectURL(
            new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
          );
          try {
            await draw(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        return canvas.toDataURL('image/png');
      },
    }),
    [layout]
  );

  if (unsupported) {
    return (
      <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-amber-400">
        {unsupported}
      </div>
    );
  }

  const segment = (
    a: { left: number; top: number },
    b: { left: number; top: number },
    color: string,
    key: string,
    dim: boolean
  ) => (
    <line
      key={key}
      x1={a.left}
      y1={a.top}
      x2={b.left}
      y2={b.top}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      opacity={dim ? 0.35 : 1}
    />
  );

  return (
    <div
      className={`relative h-full w-full select-none overflow-hidden bg-black ${
        measureMode !== 'none' ? 'cursor-crosshair' : ''
      }`}
    >
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
      {layout && (overlay.items.length > 0 || overlay.pending.length > 0) && (
        <svg
          ref={overlayRef}
          className="pointer-events-none absolute inset-0"
          width={layout.cssWidth}
          height={layout.cssHeight}
        >
          {overlay.items.map(item => {
            const [a, b, c, d] = item.points;
            const mid = item.kind === 'stenosis' && c && d ? c : a;
            return (
              <g key={item.id}>
                {segment(a, b, item.color, `${item.id}-ref`, item.dim)}
                {item.kind === 'stenosis' &&
                  c &&
                  d &&
                  segment(c, d, item.color, `${item.id}-min`, item.dim)}
                {item.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.left}
                    cy={p.top}
                    r={3}
                    fill={item.color}
                    stroke="#000"
                    strokeWidth={1}
                    opacity={item.dim ? 0.35 : 1}
                  />
                ))}
                {item.label && (
                  <text
                    x={Math.min(layout.cssWidth - 4, Math.max(mid.left, b.left) + 6)}
                    y={mid.top - 6}
                    fill="#fff"
                    fontSize={11}
                    paintOrder="stroke"
                    stroke="#000"
                    strokeWidth={3}
                    opacity={item.dim ? 0.5 : 1}
                  >
                    {item.label}
                  </text>
                )}
              </g>
            );
          })}
          {overlay.pending.map((p, i) => (
            <circle
              key={`pending-${i}`}
              cx={p.left}
              cy={p.top}
              r={4}
              fill="none"
              stroke="#67e8f9"
              strokeWidth={2}
            />
          ))}
          {overlay.pending.length === 1 && measureMode !== 'none' && null}
        </svg>
      )}
    </div>
  );
});

export default CprView;
