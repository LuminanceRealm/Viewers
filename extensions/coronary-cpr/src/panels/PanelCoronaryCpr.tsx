import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Button, useViewportGrid } from '@ohif/ui-next';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import CprView, { hasWebGL2 } from '../components/CprView';
import {
  ARTERIES,
  BETA_NOTICE,
  CROP_MARGIN_MM,
  MAX_WIDTH_MM,
  MIN_WIDTH_MM,
  RESAMPLE_STEP_MM,
  TOOL_NAME,
  Vec3,
  WL_PRESETS,
  arteryById,
  arteryCss,
} from '../constants';
import { emptySeriesState, useCprStore } from '../store/useCprStore';
import { buildOrientedCenterline } from '../utils/centerlineGeometry';
import { lengthMm, POINTS_REQUIRED, stenosis } from '../utils/measurements';
import { boxAroundPoints, boxContains, getVolumeSampler, IJKBox } from '../utils/volumeSampler';

/** Holgura extra del recorte para no reconstruirlo con cada punto nuevo. */
const CROP_SLACK_MM = 15;

export default function PanelCoronaryCpr() {
  const { servicesManager, commandsManager } = useSystem();
  const { viewportGridService, displaySetService } = servicesManager.services;
  const [{ activeViewportId }] = useViewportGrid();

  const uids = viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) ?? [];
  const displaySet = uids.length ? displaySetService.getDisplaySetByUID(uids[0]) : undefined;
  const uid = displaySet?.displaySetInstanceUID;
  const isCT = displaySet?.Modality === 'CT';

  const series = useCprStore(s => (uid ? s.bySeries[uid] : undefined)) ?? emptySeriesState();
  const update = useCprStore(s => s.update);
  const rotate = useCprStore(s => s.rotate);
  const setWidth = useCprStore(s => s.setWidth);
  const setWindowLevel = useCprStore(s => s.setWindowLevel);
  const setMeasureMode = useCprStore(s => s.setMeasureMode);
  const addMeasurePoint = useCprStore(s => s.addMeasurePoint);
  const removeMeasurement = useCprStore(s => s.removeMeasurement);

  const [busy, setBusy] = useState(false);
  const webgl2 = useMemo(() => hasWebGL2(), []);
  const [imageData, setImageData] = useState<vtkImageData | null>(null);
  const cropRef = useRef<{ box: IJKBox; widthMm: number } | null>(null);

  const activePointsRaw = series.arteries[series.activeArtery];
  const activePoints = useMemo(() => activePointsRaw ?? [], [activePointsRaw]);

  const centerline = useMemo(
    () => buildOrientedCenterline(activePoints, RESAMPLE_STEP_MM, series.angleDeg),
    [activePoints, series.angleDeg]
  );

  const visibleMeasurements = useMemo(
    () => series.measurements.filter(m => m.arteryId === series.activeArtery),
    [series.measurements, series.activeArtery]
  );

  // Recorte del volumen alrededor del trazado; se rehace sólo si el trazado se
  // sale del cubo actual o el ancho crece.
  useEffect(() => {
    if (!uid || !series.ready || !centerline) {
      setImageData(null);
      cropRef.current = null;
      return;
    }
    const sampler = getVolumeSampler(uid);
    if (!sampler) {
      return;
    }
    const required = boxAroundPoints(
      sampler,
      centerline.samples,
      series.widthMm / 2 + CROP_MARGIN_MM
    );
    const current = cropRef.current;
    if (current && current.widthMm >= series.widthMm && boxContains(current.box, required)) {
      return;
    }
    try {
      const box = boxAroundPoints(
        sampler,
        centerline.samples,
        series.widthMm / 2 + CROP_MARGIN_MM + CROP_SLACK_MM
      );
      const t0 = performance.now();
      const data = sampler.buildCroppedImageData(box);
      const dims = data.getDimensions();
      console.info(`[CPR] recorte ${dims.join('×')} en ${(performance.now() - t0).toFixed(0)} ms`);
      cropRef.current = { box, widthMm: series.widthMm };
      setImageData(data);
      if (series.error) {
        update(uid, { error: null });
      }
    } catch (error) {
      console.error(error);
      update(uid, { error: (error as Error).message });
    }
  }, [uid, series.ready, series.widthMm, centerline, series.error, update]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await commandsManager.run('coronaryCprActivate', { viewportId: activeViewportId });
    } finally {
      setBusy(false);
    }
  }, [commandsManager, activeViewportId]);

  const activateTool = useCallback(() => {
    commandsManager.run('setToolActiveToolbar', {
      toolName: TOOL_NAME,
      toolGroupIds: ['default', 'mpr'],
    });
  }, [commandsManager]);

  const onPick = useCallback(
    (distance: number, world: Vec3) => {
      if (!uid) {
        return;
      }
      update(uid, { cursorDistance: distance });
      commandsManager.run('coronaryCprJumpTo', { uid, world });
    },
    [uid, update, commandsManager]
  );
  const onMeasurePoint = useCallback(
    (world: Vec3) => uid && addMeasurePoint(uid, world),
    [uid, addMeasurePoint]
  );
  const onWindowLevel = useCallback(
    (w: number, l: number) => uid && setWindowLevel(uid, w, l),
    [uid, setWindowLevel]
  );
  const onRotate = useCallback((delta: number) => uid && rotate(uid, delta), [uid, rotate]);
  const onError = useCallback(
    (message: string) => uid && update(uid, { error: message }),
    [uid, update]
  );

  const exportCsv = () => {
    if (!uid) {
      return;
    }
    commandsManager.run('coronaryCprExportCSV', {
      uid,
      seriesLabel: displaySet?.SeriesDescription ?? '',
    });
  };

  if (!uid || !series.ready) {
    return (
      <div className="flex flex-col gap-3 p-3 text-sm text-white">
        <p className="text-xs leading-snug text-amber-400">{BETA_NOTICE}</p>
        <p className="text-muted-foreground leading-snug">
          Reformateo curvo de coronarias sobre angio-CT. Traza la arteria con clics en la imagen y
          el panel la muestra estirada en un plano.
        </p>
        {displaySet && !isCT && (
          <p className="text-amber-400">La serie activa no es una tomografía computarizada.</p>
        )}
        {!displaySet && <p className="text-muted-foreground">Selecciona una serie para empezar.</p>}
        {series.error && <p className="text-amber-400">{series.error}</p>}
        <Button
          onClick={start}
          disabled={!isCT || busy}
        >
          {busy ? 'Preparando…' : 'Iniciar CPR'}
        </Button>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `flex flex-col items-center gap-0.5 rounded px-1 py-1 text-xs transition-colors ${
      active ? 'bg-primary/30 ring-primary ring-1' : 'bg-secondary-dark hover:bg-accent'
    }`;

  const measureButton = (kind: 'length' | 'stenosis', label: string) => {
    const active = series.measureMode === kind;
    return (
      <button
        type="button"
        className={`rounded px-2 py-0.5 text-xs ${
          active ? 'bg-primary/30 ring-primary ring-1' : 'bg-secondary-dark hover:bg-accent'
        }`}
        disabled={!centerline}
        onClick={() => setMeasureMode(uid, active ? 'none' : kind)}
      >
        {label}
      </button>
    );
  };

  const pendingHint = (() => {
    if (series.measureMode === 'none') {
      return null;
    }
    const need = POINTS_REQUIRED[series.measureMode] - series.pendingPoints.length;
    if (series.measureMode === 'length') {
      return need === 2
        ? 'Regla: marca el primer punto en la tira.'
        : 'Regla: marca el segundo punto.';
    }
    const steps = [
      'Estenosis: marca el diámetro de referencia (1 de 2).',
      'Estenosis: marca el diámetro de referencia (2 de 2).',
      'Estenosis: marca el diámetro mínimo (1 de 2).',
      'Estenosis: marca el diámetro mínimo (2 de 2).',
    ];
    return steps[4 - need] ?? null;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-sm text-white">
      <p className="text-[11px] leading-snug text-amber-400">{BETA_NOTICE}</p>
      <div className="grid grid-cols-4 gap-1">
        {ARTERIES.map(artery => {
          const count = (series.arteries[artery.id] ?? []).length;
          return (
            <button
              key={artery.id}
              type="button"
              title={artery.label}
              className={chip(artery.id === series.activeArtery)}
              onClick={() =>
                commandsManager.run('coronaryCprSetArtery', { uid, arteryId: artery.id })
              }
            >
              <span className="flex items-center gap-1">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: arteryCss(artery.color) }}
                />
                {artery.short}
              </span>
              <span className="text-muted-foreground text-[10px] tabular-nums">
                {count} {count === 1 ? 'punto' : 'puntos'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={activateTool}
        >
          Trazar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!activePoints.length}
          onClick={() =>
            commandsManager.run('coronaryCprUndoPoint', { uid, arteryId: series.activeArtery })
          }
        >
          Deshacer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!activePoints.length}
          onClick={() =>
            commandsManager.run('coronaryCprClearArtery', { uid, arteryId: series.activeArtery })
          }
        >
          Borrar
        </Button>
        <label className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={series.snapEnabled}
            onChange={e => update(uid, { snapEnabled: e.target.checked })}
          />
          Imán al lumen
        </label>
      </div>

      {series.error && <p className="text-xs text-amber-400">{series.error}</p>}

      <div
        className="relative min-h-0 flex-1"
        data-cy="cpr-view"
      >
        {!webgl2 ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-amber-400">
            Este navegador no tiene WebGL2; la vista CPR no está disponible. El trazado sí se puede
            hacer.
          </div>
        ) : centerline ? (
          <CprView
            imageData={imageData}
            centerline={centerline}
            widthMm={series.widthMm}
            mode={series.mode}
            window={series.window}
            level={series.level}
            cursorDistance={series.cursorDistance}
            measurements={visibleMeasurements}
            measureMode={series.measureMode}
            pendingPoints={series.pendingPoints}
            onPick={onPick}
            onMeasurePoint={onMeasurePoint}
            onWindowLevel={onWindowLevel}
            onRotate={onRotate}
            onError={onError}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-xs leading-snug">
            Marca al menos dos puntos sobre la arteria, del ostium hacia distal. El clic se imanta
            al lumen contrastado.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground w-12">Medir</span>
          {measureButton('length', 'Regla')}
          {measureButton('stenosis', 'Estenosis')}
          {series.measureMode !== 'none' && (
            <button
              type="button"
              className="text-muted-foreground ml-auto hover:text-white"
              onClick={() => setMeasureMode(uid, 'none')}
            >
              Cancelar
            </button>
          )}
        </div>
        {pendingHint && <p className="text-[11px] text-cyan-300">{pendingHint}</p>}
        {visibleMeasurements.length > 0 && (
          <ul
            className="flex flex-col gap-0.5"
            data-cy="cpr-measurements"
          >
            {visibleMeasurements.map(m => {
              const color = arteryCss(arteryById(m.arteryId)?.color ?? [200, 200, 200, 255]);
              let text = '';
              if (m.kind === 'length') {
                const l = lengthMm(m.points);
                text = l === null ? '' : `Regla · ${l.toFixed(1)} mm`;
              } else {
                const s = stenosis(m.points);
                text = s
                  ? `Estenosis · ${s.percent === null ? '–' : `${s.percent.toFixed(0)} %`} (ref ${s.referenceMm.toFixed(1)} mm, mín ${s.minimalMm.toFixed(1)} mm)`
                  : '';
              }
              return (
                <li
                  key={m.id}
                  className="bg-secondary-dark flex items-center gap-2 rounded px-1.5 py-0.5"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 tabular-nums">{text}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-white"
                    title="Quitar medición"
                    onClick={() => removeMeasurement(uid, m.id)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12">Ancho</span>
          <input
            type="range"
            min={MIN_WIDTH_MM}
            max={MAX_WIDTH_MM}
            step={5}
            value={series.widthMm}
            onChange={e => setWidth(uid, Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-12 text-right tabular-nums">{series.widthMm} mm</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12">Giro</span>
          <input
            type="range"
            min={0}
            max={355}
            step={5}
            value={series.angleDeg}
            onChange={e => update(uid, { angleDeg: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-12 text-right tabular-nums">{series.angleDeg}°</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded px-2 py-0.5 ${series.mode === 'straightened' ? 'bg-primary/30' : 'bg-secondary-dark'}`}
            onClick={() => update(uid, { mode: 'straightened' })}
          >
            Recto
          </button>
          <button
            type="button"
            className={`rounded px-2 py-0.5 ${series.mode === 'stretched' ? 'bg-primary/30' : 'bg-secondary-dark'}`}
            onClick={() => update(uid, { mode: 'stretched' })}
          >
            Estirado
          </button>
          <span className="ml-auto flex gap-1">
            {WL_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                title={`W ${p.window} L ${p.level}`}
                className="bg-secondary-dark hover:bg-accent rounded px-1.5 py-0.5"
                onClick={() => setWindowLevel(uid, p.window, p.level)}
              >
                {p.label}
              </button>
            ))}
          </span>
        </div>
        <div className="text-muted-foreground flex items-center justify-between">
          <span>
            W {Math.round(series.window)} · L {Math.round(series.level)}
          </span>
          {centerline && <span>{centerline.lengthMm.toFixed(0)} mm de vaso</span>}
          {series.measurements.length > 0 && (
            <button
              type="button"
              className="hover:text-white"
              onClick={exportCsv}
            >
              Descargar CSV
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
