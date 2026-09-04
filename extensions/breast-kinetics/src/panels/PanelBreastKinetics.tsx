import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Button, Slider, useViewportGrid } from '@ohif/ui-next';

import KineticsChart, { ChartSeries } from '../components/KineticsChart';
import { BETA_NOTICE, MAX_RADIUS_MM, MIN_RADIUS_MM, MOTION_WARN_MM, roiColor } from '../constants';
import { emptyStudyState, phaseKey, useKineticsStore } from '../store/useKineticsStore';
import { CURVE_TYPE_LABELS, INITIAL_LABELS, computeKinetics } from '../utils/kinetics';
import { orderPhases, timeAxis } from '../utils/phaseMatching';
import { sampleRois, StudySamples } from '../utils/sampleRois';
import type { CsvRow } from '../commandsModule';

function formatClock(seconds: number | null): string {
  if (seconds === null) {
    return 'sin hora';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PanelBreastKinetics() {
  const { servicesManager, commandsManager } = useSystem();
  const { viewportGridService, displaySetService } = servicesManager.services;
  const [{ activeViewportId }] = useViewportGrid();

  const uids = viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) ?? [];
  const displaySet = uids.length ? displaySetService.getDisplaySetByUID(uids[0]) : undefined;
  const studyUid: string | undefined = displaySet?.StudyInstanceUID;
  const supported = displaySet && ['MR', 'CT'].includes(displaySet.Modality);

  const study =
    useKineticsStore(s => (studyUid ? s.byStudy[studyUid] : undefined)) ?? emptyStudyState();

  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<StudySamples | null>(null);
  const [sampling, setSampling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fases activas en orden temporal.
  const orderedPhases = useMemo(
    () => orderPhases(study.phases.filter(p => p.active)),
    [study.phases]
  );
  const times = useMemo(
    () => timeAxis(orderedPhases.map(p => p.acquisitionSeconds)),
    [orderedPhases]
  );

  // Muestreo (con retardo) cuando cambian ROIs, fases o radio.
  useEffect(() => {
    if (!studyUid || !study.ready || !study.rois.length || orderedPhases.length < 1) {
      setSamples(null);
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(async () => {
      setSampling(true);
      try {
        const result = await sampleRois(orderedPhases, study.rois, uid =>
          displaySetService.getDisplaySetByUID(uid)
        );
        setSamples(result);
        // Si la hora de alguna fase no se había leído, tomarla del corte muestreado.
        Object.entries(result.times).forEach(([key, t]) => {
          const phase = study.phases.find(p => phaseKey(p) === key);
          if (phase && phase.acquisitionSeconds === null && t.seconds !== null) {
            useKineticsStore.getState().setPhaseTime(studyUid, key, t.seconds, t.source);
          }
        });
      } catch (error) {
        console.error(error);
        useKineticsStore.getState().update(studyUid, { error: (error as Error).message });
      } finally {
        setSampling(false);
      }
    }, 200);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [studyUid, study.ready, study.rois, orderedPhases, displaySetService, study.phases]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await commandsManager.run('breastKineticsActivate', { viewportId: activeViewportId });
    } finally {
      setBusy(false);
    }
  }, [commandsManager, activeViewportId]);

  const kineticsByRoi = useMemo(() => {
    const map: Record<number, ReturnType<typeof computeKinetics>> = {};
    samples?.results.forEach(r => {
      map[r.roiId] = computeKinetics(r.phases.map(p => p.mean));
    });
    return map;
  }, [samples]);

  const xLabels = orderedPhases.map((p, i) =>
    times ? `${Math.round(times[i])} s` : i === 0 ? 'basal' : `fase ${i}`
  );

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      (samples?.results ?? []).map(r => {
        const roi = study.rois.find(x => x.id === r.roiId);
        const k = kineticsByRoi[r.roiId];
        return {
          id: r.roiId,
          label: roi?.label ?? `ROI ${r.roiId}`,
          color: roiColor(roi?.colorIndex ?? 0),
          points: r.phases.map((p, i) => ({
            x: times && Number.isFinite(times[i]) ? times[i] : i,
            y: k?.relativePct[i] ?? null,
            raw: p.mean,
            flagged: p.shiftMm !== null && p.shiftMm > MOTION_WARN_MM,
          })),
        };
      }),
    [samples, study.rois, kineticsByRoi, times]
  );

  const exportCsv = () => {
    const rows: CsvRow[] = (samples?.results ?? []).map(r => {
      const roi = study.rois.find(x => x.id === r.roiId);
      return {
        roiLabel: roi?.label ?? `ROI ${r.roiId}`,
        radiusMm: roi?.radiusMm ?? 0,
        phaseLabels: orderedPhases.map(p => p.label),
        times: orderedPhases.map((_, i) => (times ? times[i] : null)),
        means: r.phases.map(p => p.mean),
        kinetics: kineticsByRoi[r.roiId],
      };
    });
    commandsManager.run('breastKineticsExportCSV', {
      rows,
      studyLabel: displaySet?.StudyDescription ?? displaySet?.StudyInstanceUID ?? '',
    });
  };

  if (!studyUid || !study.ready) {
    return (
      <div className="flex flex-col gap-3 p-3 text-sm text-white">
        <p className="text-xs leading-snug text-amber-400">{BETA_NOTICE}</p>
        <p className="text-muted-foreground leading-snug">
          Curvas cinéticas de resonancia dinámica: marca una región sobre la lesión y el panel
          grafica su intensidad en cada fase, con realce inicial, comportamiento tardío y tipo
          BI-RADS.
        </p>
        {!displaySet && <p className="text-muted-foreground">Selecciona una serie para empezar.</p>}
        {displaySet && !supported && (
          <p className="text-amber-400">La serie activa no es una resonancia.</p>
        )}
        {study.error && <p className="text-amber-400">{study.error}</p>}
        <Button
          onClick={start}
          disabled={!supported || busy}
        >
          {busy ? 'Buscando fases…' : 'Iniciar curvas cinéticas'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2 text-sm text-white">
      <p className="text-[11px] leading-snug text-amber-400">{BETA_NOTICE}</p>
      <section>
        <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
          <span>Fases ({orderedPhases.length} activas)</span>
          {!times && orderedPhases.length > 1 && (
            <span className="text-amber-400">sin hora en los archivos: eje por fase</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          {orderPhases(study.phases).map(p => (
            <label
              key={phaseKey(p)}
              className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs ${
                p.active ? 'bg-secondary-dark' : 'text-muted-foreground'
              }`}
            >
              <input
                type="checkbox"
                checked={p.active}
                onChange={() =>
                  commandsManager.run('breastKineticsTogglePhase', { studyUid, key: phaseKey(p) })
                }
              />
              <span
                className="flex-1 truncate"
                title={`${p.label} · ${p.description}`}
              >
                {p.label}
                {p.derived ? ' · derivada' : ''}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatClock(p.acquisitionSeconds)}
              </span>
            </label>
          ))}
        </div>
        {study.phases.length < 2 && (
          <p className="mt-1 text-xs text-amber-400">
            Sólo hay una fase con esta geometría; las curvas necesitan varias.
          </p>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            commandsManager.run('setToolActiveToolbar', {
              toolName: 'BreastKinetics',
              toolGroupIds: ['default'],
            })
          }
        >
          Marcar ROI
        </Button>
        <div className="text-muted-foreground flex flex-1 items-center gap-2 text-xs">
          <span title="Radio de la ROI activa">Radio</span>
          <Slider
            min={MIN_RADIUS_MM}
            max={MAX_RADIUS_MM}
            step={1}
            value={[study.radiusMm]}
            onValueChange={([radiusMm]) =>
              commandsManager.run('breastKineticsSetRadius', { studyUid, radiusMm })
            }
            className="flex-1"
            aria-label="Radio de la ROI en milímetros"
          />
          <span className="w-12 text-right tabular-nums text-white">{study.radiusMm} mm</span>
        </div>
      </section>

      {study.rois.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-snug">
          Haz clic sobre la lesión en la imagen para colocar una ROI. Puedes arrastrarla y marcar
          varias.
        </p>
      ) : (
        <>
          <section data-cy="kinetics-chart">
            <KineticsChart
              series={chartSeries}
              xLabels={xLabels}
              xAxisLabel={times ? 'Tiempo desde la fase basal (s)' : 'Fase'}
            />
            {chartSeries.length >= 2 && (
              <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-[11px]">
                {chartSeries.map(s => (
                  <span
                    key={s.id}
                    className="flex items-center gap-1"
                  >
                    <span
                      className="inline-block h-0.5 w-3"
                      style={{ background: s.color }}
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-1">
            {study.rois.map(roi => {
              const k = kineticsByRoi[roi.id];
              const active = roi.id === study.activeRoiId;
              return (
                <div
                  key={roi.id}
                  className={`rounded px-2 py-1.5 text-xs ${
                    active ? 'bg-primary/20 ring-primary ring-1' : 'bg-secondary-dark'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: roiColor(roi.colorIndex) }}
                    />
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() =>
                        commandsManager.run('breastKineticsJumpToRoi', { studyUid, roiId: roi.id })
                      }
                      title="Ir al corte de la ROI"
                    >
                      {roi.label}
                    </button>
                    <span className="text-muted-foreground">r {roi.radiusMm} mm</span>
                    <button
                      type="button"
                      className="text-muted-foreground ml-auto hover:text-white"
                      title="Quitar ROI"
                      onClick={() =>
                        commandsManager.run('breastKineticsRemoveRoi', { studyUid, roiId: roi.id })
                      }
                    >
                      ✕
                    </button>
                  </div>
                  {k ? (
                    <div className="mt-1 grid grid-cols-3 gap-1 tabular-nums">
                      <div>
                        <div className="text-muted-foreground">Basal</div>
                        <div>{Number.isFinite(k.s0) ? k.s0.toFixed(0) : '–'}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Inicial</div>
                        <div>
                          {k.initialPct === null ? '–' : `${k.initialPct.toFixed(0)} %`}
                          {k.initialCategory ? ` · ${INITIAL_LABELS[k.initialCategory]}` : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Tardío</div>
                        <div>{k.delayedPct === null ? '–' : `${k.delayedPct.toFixed(0)} %`}</div>
                      </div>
                      <div className="col-span-3 mt-0.5">
                        {k.type ? (
                          <span className="font-medium">{CURVE_TYPE_LABELS[k.type]}</span>
                        ) : (
                          <span className="text-amber-400">{k.reason}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground mt-1">
                      {sampling ? 'Midiendo…' : 'Sin medición'}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {samples?.warnings.length ? (
            <ul className="flex flex-col gap-0.5 text-xs text-amber-400">
              {samples.warnings.map(w => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {study.error && <p className="text-xs text-amber-400">{study.error}</p>}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={exportCsv}
            >
              Descargar CSV
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
