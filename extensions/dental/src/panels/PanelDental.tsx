import React, { useCallback, useMemo, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Button, Slider, useViewportGrid } from '@ohif/ui-next';

import {
  BETA_NOTICE,
  MAX_SLAB_MM,
  NERVES,
  NerveId,
  RULER_COLOR,
  SECTION_SPACINGS_MM,
  SECTION_WIDTHS_MM,
} from '../constants';
import { DockTool, emptySeriesState, useDentalStore } from '../store/useDentalStore';
import { buildSeriesArch, rulerOverlay } from '../utils/model';
import printDentalReport from '../utils/printDental';
import { getVolumeGrid } from '../utils/volumeGrid';

export default function PanelDental() {
  const { servicesManager, commandsManager } = useSystem();
  const { viewportGridService, displaySetService } = servicesManager.services;
  const [{ activeViewportId }] = useViewportGrid();

  const uids = viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) ?? [];
  const displaySet = uids.length ? displaySetService.getDisplaySetByUID(uids[0]) : undefined;
  const uid = displaySet?.displaySetInstanceUID;
  const isCT = displaySet?.Modality === 'CT';

  const series = useDentalStore(s => (uid ? s.bySeries[uid] : undefined)) ?? emptySeriesState();
  const dockOpen = useDentalStore(s => s.dockOpen && s.activeUid === uid);
  const store = useDentalStore;
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const grid = uid && series.ready ? getVolumeGrid(uid) : undefined;
  const arch = useMemo(
    () => (grid ? buildSeriesArch(grid, series.arch) : null),
    [grid, series.arch]
  );
  const rulers = useMemo(
    () => (grid && arch ? series.rulers.map(r => rulerOverlay(grid, arch, r)) : []),
    [grid, arch, series.rulers]
  );

  const start = useCallback(
    () => commandsManager.run('dentalActivate', { viewportId: activeViewportId }),
    [commandsManager, activeViewportId]
  );

  if (!uid || !series.ready) {
    const loading = series.loading !== null;
    return (
      <div className="flex flex-col gap-3 p-3 text-sm text-white">
        <p className="text-xs leading-snug text-amber-400">{BETA_NOTICE}</p>
        <p className="text-muted-foreground leading-snug">
          Panorámica y cortes transversales a partir de una tomografía dental (CBCT). Traza el arco
          sobre un corte axial y la reconstrucción aparece bajo la imagen.
        </p>
        {displaySet && !isCT && (
          <p className="text-amber-400">La serie activa no es una tomografía.</p>
        )}
        {!displaySet && <p className="text-muted-foreground">Selecciona una serie para empezar.</p>}
        {series.error && <p className="text-amber-400">{series.error}</p>}
        <Button
          onClick={start}
          disabled={!isCT || loading}
        >
          {loading ? `Cargando cortes… ${Math.round((series.loading ?? 0) * 100)} %` : 'Iniciar'}
        </Button>
      </div>
    );
  }

  const state = store.getState();
  const setTool = (tool: DockTool) => {
    state.setTool(uid, series.tool === tool ? 'navigate' : tool);
    if (!dockOpen) {
      state.setDock({ activeUid: uid, open: true });
    }
  };

  const chip = (active: boolean) =>
    `rounded px-2 py-0.5 text-xs transition-colors ${
      active ? 'bg-primary/30 ring-primary ring-1' : 'bg-secondary-dark hover:bg-accent'
    }`;
  const row = 'flex flex-wrap items-center gap-1';
  const rowLabel = 'text-muted-foreground w-14 shrink-0 text-xs';

  const activeNerve: NerveId | null =
    series.tool === 'nerveR' ? 'R' : series.tool === 'nerveL' ? 'L' : null;

  const exportPdf = async () => {
    if (!grid) {
      return;
    }
    setPrinting(true);
    setPrintError(null);
    try {
      await printDentalReport({ displaySet, grid, series, viewportIds: [activeViewportId] });
    } catch (error) {
      console.error(error);
      setPrintError((error as Error).message || 'No se pudo preparar la hoja.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2 text-sm text-white">
      <p className="text-[11px] leading-snug text-amber-400">{BETA_NOTICE}</p>

      {grid && grid.tiltDeg > 20 && (
        <p className="text-xs leading-snug text-amber-400">
          Los cortes de esta serie no son axiales (inclinación de {grid.tiltDeg.toFixed(0)}°): la
          reconstrucción supone que el arco se traza sobre un corte axial.
        </p>
      )}

      <section className="flex flex-col gap-1.5">
        <div className={row}>
          <span className={rowLabel}>Arco</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => commandsManager.run('dentalTraceArch')}
          >
            Trazar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!series.arch.length}
            onClick={() => state.undoArchPoint(uid)}
          >
            Deshacer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!series.arch.length}
            onClick={() => state.clearArch(uid)}
            title="Borra el arco, el canal y las mediciones"
          >
            Borrar
          </Button>
        </div>
        <p className="text-muted-foreground text-[11px] leading-snug">
          {arch
            ? `${series.arch.length} puntos · ${arch.lengthMm.toFixed(0)} mm. Arrastra un punto para ajustarlo o haz clic sobre la curva para añadir otro.`
            : 'Clics a lo largo de la arcada sobre el corte axial, de un lado al otro.'}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className={rowLabel}>Grosor</span>
          <Slider
            min={0}
            max={MAX_SLAB_MM}
            step={1}
            value={[series.slabMm]}
            onValueChange={([slabMm]) => state.setSlab(uid, slabMm)}
            className="flex-1"
            aria-label="Grosor de la panorámica en milímetros"
          />
          <span className="w-12 text-right text-xs tabular-nums">{series.slabMm} mm</span>
        </div>
        <div className={row}>
          <span className={rowLabel}>Modo</span>
          <button
            type="button"
            className={chip(series.projection === 'avg')}
            title="Promedio del grosor: se parece a una radiografía panorámica"
            onClick={() => state.update(uid, { projection: 'avg' })}
          >
            Promedio
          </button>
          <button
            type="button"
            className={chip(series.projection === 'max')}
            title="Máxima intensidad del grosor: resalta dientes y metal"
            onClick={() => state.update(uid, { projection: 'max' })}
          >
            MIP
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className={row}>
          <span className={rowLabel}>Cortes</span>
          {SECTION_SPACINGS_MM.map(mm => (
            <button
              key={mm}
              type="button"
              className={chip(series.sectionSpacingMm === mm)}
              title={`Un corte transversal cada ${mm} mm`}
              onClick={() => state.update(uid, { sectionSpacingMm: mm })}
            >
              {mm} mm
            </button>
          ))}
        </div>
        <div className={row}>
          <span className={rowLabel}>Ancho</span>
          {SECTION_WIDTHS_MM.map(mm => (
            <button
              key={mm}
              type="button"
              className={chip(series.sectionWidthMm === mm)}
              onClick={() => state.update(uid, { sectionWidthMm: mm })}
            >
              {mm} mm
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className={row}>
          <span className={rowLabel}>Canal</span>
          {NERVES.map(nerve => {
            const tool: DockTool = nerve.id === 'R' ? 'nerveR' : 'nerveL';
            const count = series.nerves[nerve.id].length;
            return (
              <button
                key={nerve.id}
                type="button"
                className={`${chip(series.tool === tool)} flex items-center gap-1`}
                title={`${nerve.label}: márcalo en los cortes transversales`}
                disabled={!arch}
                onClick={() => setTool(tool)}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: nerve.color }}
                />
                {nerve.short}
                {count > 0 && <span className="text-muted-foreground tabular-nums">{count}</span>}
              </button>
            );
          })}
          {activeNerve && (
            <span className="ml-auto flex gap-2 text-xs">
              <button
                type="button"
                className="text-muted-foreground hover:text-white disabled:opacity-40"
                disabled={!series.nerves[activeNerve].length}
                onClick={() => state.undoNervePoint(uid, activeNerve)}
              >
                Deshacer
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-white disabled:opacity-40"
                disabled={!series.nerves[activeNerve].length}
                onClick={() => state.clearNerve(uid, activeNerve)}
              >
                Borrar
              </button>
            </span>
          )}
        </div>
        {activeNerve && (
          <p className="text-[11px] leading-snug text-cyan-300">
            Marca el canal en un corte transversal, avanza con la rueda y repite. Arrastra un punto
            para corregirlo.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className={row}>
          <span className={rowLabel}>Medir</span>
          <button
            type="button"
            className={chip(series.tool === 'ruler')}
            disabled={!arch}
            onClick={() => setTool('ruler')}
          >
            Regla
          </button>
        </div>
        {series.tool === 'ruler' && (
          <p className="text-[11px] leading-snug text-cyan-300">
            {series.pending
              ? 'Marca el segundo punto en la misma vista.'
              : 'Marca dos puntos en la panorámica o en un corte transversal.'}
          </p>
        )}
        {rulers.length > 0 && (
          <ul
            className="flex flex-col gap-0.5 text-xs"
            data-cy="dental-rulers"
          >
            {rulers.map((r, i) => (
              <li
                key={r.id}
                className="bg-secondary-dark flex items-center gap-2 rounded px-1.5 py-0.5"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: RULER_COLOR }}
                />
                <button
                  type="button"
                  className="flex-1 text-left tabular-nums hover:text-white"
                  title="Ir a esta medición"
                  onClick={() => {
                    state.update(uid, { cursorS: r.sectionS ?? (r.p.s + r.q.s) / 2 });
                    state.setDock({ activeUid: uid, open: true });
                  }}
                >
                  {i + 1} · {r.lengthMm.toFixed(1)} mm
                  <span className="text-muted-foreground">
                    {r.view === 'pano'
                      ? ' · panorámica'
                      : ` · corte ${Math.round((r.sectionS ?? 0) / series.sectionSpacingMm)}`}
                  </span>
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-white"
                  title="Quitar medición"
                  onClick={() => state.removeRuler(uid, r.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {rulers.some(r => r.view === 'pano') && (
          <p className="text-muted-foreground text-[11px] leading-snug">
            En la panorámica la regla mide sobre la superficie curva; en un corte, la distancia
            real.
          </p>
        )}
      </section>

      <section className="mt-auto flex flex-col gap-1.5 text-xs">
        {printError && <p className="text-amber-400">{printError}</p>}
        <div className="text-muted-foreground flex items-center gap-3">
          <button
            type="button"
            className="hover:text-white"
            onClick={() => state.setDock({ activeUid: uid, open: !dockOpen })}
          >
            {dockOpen ? 'Ocultar panorámica' : 'Mostrar panorámica'}
          </button>
          {(series.panoWl || series.crossWl) && (
            <button
              type="button"
              className="hover:text-white"
              title="Vuelve a la ventana automática"
              onClick={() => state.update(uid, { panoWl: null, crossWl: null })}
            >
              Ventana auto
            </button>
          )}
          <button
            type="button"
            className="ml-auto hover:text-white disabled:opacity-40"
            disabled={!arch || printing}
            onClick={exportPdf}
            title="Abre la hoja de impresión a tamaño real; desde ahí se guarda como PDF"
          >
            {printing ? 'Preparando…' : 'PDF'}
          </button>
        </div>
      </section>
    </div>
  );
}
