import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';

import { NerveId, SAME_SECTION_TOLERANCE_MM, Vec3 } from '../constants';
import { useDentalStore } from '../store/useDentalStore';
import { archToWorld, clampS } from '../utils/archGeometry';
import { Fit, drawPano, drawSection, fitBox, insideFit, rasterToCanvas, toMm } from '../utils/draw';
import { layoutDock } from '../utils/layout';
import {
  buildOverlays,
  buildPano,
  buildSections,
  buildSeriesArch,
  panoXToS,
  resolveCursor,
  sectionXToO,
  viewYToC,
  volumeHeightMm,
} from '../utils/model';
import { autoWindow, sampleColumns, sectionRays, WindowLevel } from '../utils/reslice';
import { getVolumeGrid } from '../utils/volumeGrid';

/** Devuelve el valor con retraso: la panorámica no se rehace en cada píxel de un arrastre. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'wl'; view: 'pano' | 'cross'; x: number; y: number; start: WindowLevel }
  | { kind: 'nerve'; nerve: NerveId; index: number; sectionIndex: number };

const HANDLE_HIT_PX = 9;

/**
 * Franja inferior de la herramienta dental: panorámica reconstruida a lo largo
 * del arco y cortes transversales alrededor del cursor, en un solo lienzo 2D.
 * Se monta siempre (ViewerLayout la pide por customization) y no pinta nada
 * mientras la herramienta no esté iniciada.
 */
export default function DentalDock() {
  const { commandsManager } = useSystem();
  const uid = useDentalStore(s => s.activeUid);
  const open = useDentalStore(s => s.dockOpen);
  const maximized = useDentalStore(s => s.dockMaximized);
  const series = useDentalStore(s => (uid ? s.bySeries[uid] : undefined));
  const setDock = useDentalStore(s => s.setDock);
  const update = useDentalStore(s => s.update);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Visible desde que se inicia: mientras cargan los cortes muestra el avance.
  const visible = Boolean(open && uid && series);
  const grid = visible && uid && series?.ready ? getVolumeGrid(uid) : undefined;

  const control = useDebounced(series?.arch, 90);
  const arch = useMemo(
    () => (grid && control ? buildSeriesArch(grid, control) : null),
    [grid, control]
  );

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const observer = new ResizeObserver(() =>
      setSize({ w: body.clientWidth, h: body.clientHeight })
    );
    observer.observe(body);
    setSize({ w: body.clientWidth, h: body.clientHeight });
    return () => observer.disconnect();
  }, [visible, Boolean(arch)]);

  const slabMm = series?.slabMm ?? 0;
  const projection = series?.projection ?? 'avg';
  const panoResult = useMemo(() => {
    if (!grid || !arch) {
      return { raster: null, error: null };
    }
    try {
      const t0 = performance.now();
      const raster = buildPano(grid, arch, slabMm, projection);
      console.info(
        `[Dental] panorámica ${raster.width}×${raster.height} en ${(performance.now() - t0).toFixed(0)} ms`
      );
      return { raster, error: null };
    } catch (e) {
      console.error(e);
      return { raster: null, error: 'No se pudo reconstruir la panorámica.' };
    }
  }, [grid, arch, slabMm, projection]);
  const pano = panoResult.raster;
  const error = panoResult.error;

  const sectionWidthMm = series?.sectionWidthMm ?? 30;
  const sectionSpacingMm = series?.sectionSpacingMm ?? 2;
  const cursorS = arch ? resolveCursor(arch, series?.cursorS ?? null) : 0;

  const layout = useMemo(() => {
    if (!grid || !arch || !size.w || !size.h) {
      return null;
    }
    const heightMm = volumeHeightMm(grid);
    return layoutDock(
      size.w,
      size.h,
      { w: arch.count * arch.stepMm, h: heightMm },
      { w: sectionWidthMm + arch.stepMm, h: heightMm }
    );
  }, [grid, arch, size, sectionWidthMm]);
  const sectionCount = layout?.sections.length ?? 0;
  useEffect(() => {
    if (sectionCount) {
      setDock({ sectionCount });
    }
  }, [sectionCount, setDock]);

  const sections = useMemo(
    () =>
      grid && arch && sectionCount
        ? buildSections(grid, arch, cursorS, sectionSpacingMm, sectionWidthMm, sectionCount)
        : [],
    [grid, arch, cursorS, sectionSpacingMm, sectionWidthMm, sectionCount]
  );

  const panoAuto = useMemo(() => (pano ? autoWindow(pano.data) : null), [pano]);
  // La ventana automática de los cortes sale del corte del centro del arco y no
  // del corte visible: si no, el contraste cambiaría al avanzar.
  const crossAuto = useMemo(() => {
    if (!grid || !arch) {
      return null;
    }
    const middle = sampleColumns(
      grid,
      sectionRays(arch, arch.lengthMm / 2, sectionWidthMm, arch.stepMm),
      'avg'
    );
    return autoWindow(middle.data);
  }, [grid, arch, sectionWidthMm]);
  const panoWl = series?.panoWl ?? panoAuto;
  const crossWl = series?.crossWl ?? crossAuto;

  const panoBitmap = useMemo(
    () => (pano && panoWl ? rasterToCanvas(pano, panoWl) : null),
    [pano, panoWl]
  );
  const sectionBitmaps = useMemo(
    () => sections.map(s => (s.raster && crossWl ? rasterToCanvas(s.raster, crossWl) : null)),
    [sections, crossWl]
  );

  const overlays = useMemo(
    () =>
      grid && arch && series
        ? buildOverlays(grid, arch, series.nerves, series.rulers, series.pending)
        : null,
    [grid, arch, series?.nerves, series?.rulers, series?.pending]
  );

  const fits = useMemo(() => {
    if (!layout || !grid || !arch) {
      return null;
    }
    const heightMm = volumeHeightMm(grid);
    const { pano: p } = layout;
    return {
      pano: fitBox(p.x, p.y, p.w, p.h, arch.count * arch.stepMm, heightMm),
      sections: layout.sections.map(b =>
        fitBox(b.x, b.y, b.w, b.h, sectionWidthMm + arch.stepMm, heightMm)
      ),
    };
  }, [layout, grid, arch, sectionWidthMm]);

  // Dibujo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fits || !grid || !arch || !overlays || !panoBitmap) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size.w, size.h);
      drawPano(ctx, fits.pano, {
        grid,
        arch,
        bitmap: panoBitmap,
        overlays,
        sectionS: sections.map(s => s.s),
        cursorS,
      });
      const center = Math.floor(sections.length / 2);
      sections.forEach((section, i) => {
        if (!fits.sections[i]) {
          return;
        }
        drawSection(ctx, fits.sections[i], {
          grid,
          section,
          bitmap: sectionBitmaps[i],
          widthMm: sectionWidthMm,
          pixelMm: arch.stepMm,
          overlays,
          isCursor: i === center,
          showScaleBar: i === 0,
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    fits,
    grid,
    arch,
    overlays,
    panoBitmap,
    sectionBitmaps,
    sections,
    cursorS,
    size,
    sectionWidthMm,
  ]);

  const moveCursor = useCallback(
    (s: number, jumpC?: number) => {
      if (!uid || !arch || !grid) {
        return;
      }
      const clamped = clampS(arch, s);
      update(uid, { cursorS: clamped });
      if (jumpC !== undefined) {
        commandsManager.run('dentalJumpTo', {
          uid,
          world: archToWorld(arch, grid, { s: clamped, o: 0, c: jumpC }),
        });
      }
    },
    [uid, arch, grid, update, commandsManager]
  );

  /** Qué hay bajo el puntero, en coordenadas de arco. */
  const hitTest = useCallback(
    (x: number, y: number) => {
      if (!fits || !grid || !arch) {
        return null;
      }
      if (insideFit(fits.pano, x, y)) {
        const [mx, my] = toMm(fits.pano, x, y);
        return {
          view: 'pano' as const,
          s: panoXToS(arch, mx),
          o: 0,
          c: viewYToC(grid, my),
          sectionIndex: -1,
          fit: fits.pano,
        };
      }
      for (let i = 0; i < fits.sections.length; i++) {
        const fit: Fit = fits.sections[i];
        const s = sections[i]?.s;
        if (s !== null && s !== undefined && insideFit(fit, x, y)) {
          const [mx, my] = toMm(fit, x, y);
          return {
            view: 'cross' as const,
            s,
            o: sectionXToO(sectionWidthMm, arch.stepMm, mx),
            c: viewYToC(grid, my),
            sectionIndex: i,
            fit,
          };
        }
      }
      return null;
    },
    [fits, grid, arch, sections, sectionWidthMm]
  );

  const pointerXY = (event: React.PointerEvent) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!uid || !series || !grid || !arch || !overlays) {
      return;
    }
    const [x, y] = pointerXY(event);
    const hit = hitTest(x, y);
    if (!hit) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const store = useDentalStore.getState();

    if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
      const start = hit.view === 'pano' ? panoWl : crossWl;
      if (start) {
        dragRef.current = { kind: 'wl', view: hit.view, x, y, start };
      }
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const world: Vec3 = archToWorld(arch, grid, { s: hit.s, o: hit.o, c: hit.c });
    if (series.tool === 'ruler') {
      store.addRulerPoint(uid, {
        view: hit.view,
        point: world,
        sectionS: hit.view === 'cross' ? hit.s : null,
      });
      return;
    }

    if (hit.view === 'cross' && (series.tool === 'nerveR' || series.tool === 'nerveL')) {
      const nerve: NerveId = series.tool === 'nerveR' ? 'R' : 'L';
      // Sobre un punto ya marcado en este corte: se arrastra. Si no, punto nuevo
      // (que también se puede ajustar sin soltar).
      let index = -1;
      overlays.nervePoints[nerve].forEach((p, i) => {
        if (Math.abs(p.s - hit.s) > SAME_SECTION_TOLERANCE_MM) {
          return;
        }
        const dx = (p.o - hit.o) * hit.fit.scale;
        const dy = (p.c - hit.c) * hit.fit.scale;
        if (Math.hypot(dx, dy) <= HANDLE_HIT_PX) {
          index = i;
        }
      });
      if (index < 0) {
        index = series.nerves[nerve].length;
        store.addNervePoint(uid, nerve, world);
      }
      dragRef.current = { kind: 'nerve', nerve, index, sectionIndex: hit.sectionIndex };
      return;
    }

    moveCursor(hit.s, hit.c);
    if (hit.view === 'pano') {
      dragRef.current = { kind: 'scrub' };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !uid || !grid || !arch || !fits) {
      return;
    }
    const [x, y] = pointerXY(event);
    if (drag.kind === 'wl') {
      const step = drag.start.window / 250;
      const next = {
        window: Math.max(1, drag.start.window + (x - drag.x) * step),
        level: drag.start.level + (y - drag.y) * step,
      };
      update(uid, drag.view === 'pano' ? { panoWl: next } : { crossWl: next });
      return;
    }
    if (drag.kind === 'scrub') {
      const [mx] = toMm(fits.pano, x, y);
      moveCursor(panoXToS(arch, mx));
      return;
    }
    const fit = fits.sections[drag.sectionIndex];
    const s = sections[drag.sectionIndex]?.s;
    if (!fit || s === null || s === undefined) {
      return;
    }
    const [mx, my] = toMm(fit, x, y);
    const half = sectionWidthMm / 2;
    const o = Math.max(-half, Math.min(half, sectionXToO(sectionWidthMm, arch.stepMm, mx)));
    useDentalStore
      .getState()
      .moveNervePoint(
        uid,
        drag.nerve,
        drag.index,
        archToWorld(arch, grid, { s, o, c: viewYToC(grid, my) })
      );
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // La rueda avanza de corte en corte. Listener nativo: React registra `wheel`
  // como pasivo y ahí no se puede evitar que la página se desplace.
  const wheelRef = useRef<(delta: number) => void>(() => undefined);
  wheelRef.current = (delta: number) => moveCursor(cursorS + Math.sign(delta) * sectionSpacingMm);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheelRef.current(event.deltaY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [visible, Boolean(arch)]);

  if (!visible || !series) {
    return null;
  }

  const tool = series.tool;
  const hint = !arch
    ? null
    : tool === 'ruler'
      ? series.pending
        ? 'Regla: marca el segundo punto en la misma vista.'
        : 'Regla: marca el primer punto en la panorámica o en un corte.'
      : tool === 'nerveR' || tool === 'nerveL'
        ? 'Canal: márcalo en los cortes transversales; la rueda avanza al siguiente corte.'
        : 'Clic: ir a ese punto · rueda: siguiente corte · clic derecho y arrastrar: ventana';

  const headerButton =
    'text-muted-foreground flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 hover:text-white';

  return (
    <div
      className="flex shrink-0 flex-col border-t border-white/10 bg-black"
      style={{ height: maximized ? '72%' : '46%' }}
      data-cy="dental-dock"
    >
      <div className="flex h-7 shrink-0 items-center gap-3 px-2 text-xs">
        <span className="shrink-0 whitespace-nowrap text-white/80">Panorámica dental</span>
        {arch && (
          <span className="text-muted-foreground min-w-0 truncate tabular-nums">
            {slabMm > 0
              ? `${projection === 'max' ? 'MIP' : 'Promedio'} ${slabMm} mm`
              : 'Corte fino'}
            {' · '}cortes cada {sectionSpacingMm} mm
          </span>
        )}
        {hint && <span className="text-muted-foreground hidden truncate md:inline">{hint}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={headerButton}
            title={maximized ? 'Reducir la franja' : 'Agrandar la franja'}
            onClick={() => setDock({ maximized: !maximized })}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={maximized ? 'M3 5l4 4 4-4' : 'M3 9l4-4 4 4'} />
            </svg>
          </button>
          <button
            type="button"
            className={headerButton}
            title="Ocultar la panorámica (el trazado se conserva)"
            onClick={() => setDock({ open: false })}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
            </svg>
          </button>
        </span>
      </div>
      <div
        ref={bodyRef}
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {arch ? (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            style={{
              touchAction: 'none',
              cursor: tool === 'navigate' ? 'pointer' : 'crosshair',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={event => event.preventDefault()}
            data-cy="dental-canvas"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm leading-snug">
            {series.error ? (
              <span className="text-amber-400">{series.error}</span>
            ) : !series.ready ? (
              `Cargando cortes… ${Math.round((series.loading ?? 0) * 100)} %`
            ) : (
              <span>
                Traza el arco sobre un corte axial: marca puntos a lo largo de la arcada, de un lado
                al otro.
                <br />
                La panorámica aparece aquí con el segundo punto.
              </span>
            )}
          </div>
        )}
        {error && (
          <p className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-amber-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
