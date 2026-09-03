import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Button, Icons, useViewportGrid } from '@ohif/ui-next';

import { ARTERIES, CANDIDATE_INDEX, HU_THRESHOLD, segmentationIdForDisplaySet } from '../constants';
import { riskCategory } from '../utils/agatston';
import type { CalciumScoreReport } from '../commandsModule';

function rgba([r, g, b, a]: number[]): string {
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
}

function formatScore(value: number): string {
  return Math.round(value).toLocaleString('es-MX');
}

function formatVolume(value: number): string {
  return value.toLocaleString('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

export default function PanelCalciumScore() {
  const { servicesManager, commandsManager } = useSystem();
  const { segmentationService, viewportGridService, displaySetService } = servicesManager.services;
  const [{ activeViewportId }] = useViewportGrid();

  // Cambia con cada evento de segmentación para forzar el recálculo.
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<CalciumScoreReport | undefined>();
  const [busy, setBusy] = useState(false);
  const computeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Se relee en cada revisión: el viewport puede cambiar de serie sin cambiar de id.
  const uids = viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) ?? [];
  const displaySet = uids.length ? displaySetService.getDisplaySetByUID(uids[0]) : undefined;

  const isCT = displaySet?.Modality === 'CT';
  const segmentationId = displaySet
    ? segmentationIdForDisplaySet(displaySet.displaySetInstanceUID)
    : undefined;
  const segmentation = segmentationId ? segmentationService.getSegmentation(segmentationId) : null;
  const activeSegmentIndex = segmentation
    ? Number(Object.values(segmentation.segments).find(s => s?.active)?.segmentIndex ?? NaN)
    : NaN;

  useEffect(() => {
    const { EVENTS } = segmentationService;
    const bump = () => setRevision(r => r + 1);
    const subscriptions = [
      EVENTS.SEGMENTATION_ADDED,
      EVENTS.SEGMENTATION_MODIFIED,
      EVENTS.SEGMENTATION_DATA_MODIFIED,
      EVENTS.SEGMENTATION_REMOVED,
      EVENTS.SEGMENTATION_REPRESENTATION_MODIFIED,
    ].map(event => segmentationService.subscribe(event, bump));

    const gridSubscription = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      bump
    );

    return () => {
      subscriptions.forEach(s => s.unsubscribe());
      gridSubscription.unsubscribe();
    };
  }, [segmentationService, viewportGridService]);

  const hasSegmentation = !!segmentation;
  useEffect(() => {
    if (!hasSegmentation || !segmentationId) {
      setReport(undefined);
      return;
    }
    if (computeTimer.current) {
      clearTimeout(computeTimer.current);
    }
    computeTimer.current = setTimeout(() => {
      const next = commandsManager.run('calciumScoreCompute', { segmentationId }) as
        | CalciumScoreReport
        | undefined;
      setReport(next);
    }, 150);
    return () => {
      if (computeTimer.current) {
        clearTimeout(computeTimer.current);
      }
    };
    // `revision` es la señal de recálculo; el objeto de segmentación cambia de identidad en
    // cada render y dispararía un bucle si fuera dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSegmentation, segmentationId, revision, commandsManager]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await commandsManager.run('calciumScoreActivate', { viewportId: activeViewportId });
    } finally {
      setBusy(false);
    }
  }, [commandsManager, activeViewportId]);

  const setArtery = (segmentIndex: number) => {
    commandsManager.run('calciumScoreSetArtery', { segmentationId, segmentIndex });
  };

  if (!displaySet) {
    return (
      <div className="text-muted-foreground p-3 text-sm">Selecciona una serie para empezar.</div>
    );
  }

  if (!segmentation) {
    return (
      <div className="flex flex-col gap-3 p-3 text-sm text-white">
        <p className="text-muted-foreground leading-snug">
          Resalta todo lo que supera {HU_THRESHOLD} HU y permite asignar cada calcificación a una
          arteria con un clic. Requiere una tomografía cardíaca sin contraste, idealmente a 120 kVp
          y cortes de 3 mm.
        </p>
        {!isCT && (
          <p className="text-amber-400">La serie activa no es una tomografía computarizada.</p>
        )}
        <Button
          onClick={start}
          disabled={!isCT || busy}
        >
          {busy ? 'Preparando…' : 'Iniciar score de calcio'}
        </Button>
      </div>
    );
  }

  const total = report?.result.total;
  const category = total ? riskCategory(total.score) : undefined;

  return (
    <div className="flex flex-col gap-3 p-3 text-sm text-white">
      <p className="text-muted-foreground leading-snug">
        Elige la arteria y haz clic sobre cada calcificación resaltada. Un segundo clic la quita.
      </p>

      <div className="grid grid-cols-5 gap-1">
        {ARTERIES.map(artery => {
          const active = artery.segmentIndex === activeSegmentIndex;
          return (
            <button
              key={artery.segmentIndex}
              type="button"
              title={artery.label}
              onClick={() => setArtery(artery.segmentIndex)}
              className={`flex flex-col items-center gap-1 rounded px-1 py-1.5 text-xs transition-colors ${
                active ? 'bg-primary/30 ring-primary ring-1' : 'bg-secondary-dark hover:bg-accent'
              }`}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: rgba(artery.color) }}
              />
              {artery.short}
            </button>
          );
        })}
        <button
          type="button"
          title="Devolver una lesión a candidato"
          onClick={() => setArtery(CANDIDATE_INDEX)}
          className={`flex flex-col items-center gap-1 rounded px-1 py-1.5 text-xs transition-colors ${
            activeSegmentIndex === CANDIDATE_INDEX
              ? 'bg-primary/30 ring-primary ring-1'
              : 'bg-secondary-dark hover:bg-accent'
          }`}
        >
          <Icons.Delete className="h-3 w-3" />
          Quitar
        </button>
      </div>

      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Arteria</th>
            <th className="py-1 text-right font-normal">Lesiones</th>
            <th className="py-1 text-right font-normal">mm³</th>
            <th className="py-1 text-right font-normal">Agatston</th>
          </tr>
        </thead>
        <tbody>
          {ARTERIES.map(artery => {
            const s = report?.result.perSegment[artery.segmentIndex];
            return (
              <tr
                key={artery.segmentIndex}
                className="border-secondary-dark border-t"
              >
                <td className="py-1">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: rgba(artery.color) }}
                  />
                  {artery.short}
                </td>
                <td className="py-1 text-right tabular-nums">{s ? s.lesions : '–'}</td>
                <td className="py-1 text-right tabular-nums">
                  {s ? formatVolume(s.volumeMm3) : '–'}
                </td>
                <td className="py-1 text-right tabular-nums">{s ? formatScore(s.score) : '–'}</td>
              </tr>
            );
          })}
          <tr className="border-secondary-dark border-t font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">{total ? total.lesions : '–'}</td>
            <td className="py-1.5 text-right tabular-nums">
              {total ? formatVolume(total.volumeMm3) : '–'}
            </td>
            <td className="py-1.5 text-right text-base tabular-nums">
              {total ? formatScore(total.score) : '–'}
            </td>
          </tr>
        </tbody>
      </table>

      {category && <p className="text-muted-foreground text-xs">{category.label}</p>}

      {report?.warnings.length ? (
        <ul className="flex flex-col gap-1 text-xs text-amber-400">
          {report.warnings.map(w => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => commandsManager.run('calciumScoreDownloadCSV', { segmentationId })}
        >
          Descargar CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => commandsManager.run('calciumScoreRemove', { segmentationId })}
        >
          Quitar score
        </Button>
      </div>
    </div>
  );
}
