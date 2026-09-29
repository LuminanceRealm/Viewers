import React, { ReactElement, useEffect, useState } from 'react';
import { Slider } from '@ohif/ui-next';

import {
  DEFAULT_SLAB_MM,
  getSlabState,
  MAX_SLAB_MM,
  MIN_SLAB_MM,
  SLAB_LABELS,
  SLAB_MODIFIED_EVENT,
  SlabMode,
} from '../../utils/slabProjection';

const MODES: SlabMode[] = ['off', 'mip', 'minip', 'avg'];

/**
 * NUBIX: control de proyección de grosor dentro del menú de cada viewport
 * MPR. Los botones eligen el modo y el deslizador el grosor; ambos pasan por
 * el comando `setSlabProjection`, que es el mismo que usa la barra.
 */
export function SlabProjection({
  viewportId,
  commandsManager,
  servicesManager,
}: withAppTypes<{ viewportId: string }>): ReactElement {
  const { cornerstoneViewportService } = servicesManager.services;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

  const [state, setState] = useState(() => getSlabState(viewport));

  useEffect(() => {
    const element = viewport?.element;
    const refresh = () => setState(getSlabState(viewport));
    element?.addEventListener(SLAB_MODIFIED_EVENT, refresh);
    return () => element?.removeEventListener(SLAB_MODIFIED_EVENT, refresh);
  }, [viewport]);

  const run = (mode: SlabMode, thickness?: number) =>
    commandsManager.run('setSlabProjection', { mode, thickness, viewportId });

  const thickness = state.mode === 'off' ? DEFAULT_SLAB_MM : Math.round(state.thickness);

  return (
    <div className="flex w-full flex-col gap-3 px-3 py-2 text-white">
      <div className="grid grid-cols-2 gap-1">
        {MODES.map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => run(mode)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              state.mode === mode
                ? 'bg-primary/30 ring-primary ring-1'
                : 'bg-secondary-dark hover:bg-accent'
            }`}
          >
            {SLAB_LABELS[mode]}
          </button>
        ))}
      </div>
      <div className={state.mode === 'off' ? 'pointer-events-none opacity-40' : ''}>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Grosor</span>
          <span className="tabular-nums">{thickness} mm</span>
        </div>
        <Slider
          min={MIN_SLAB_MM}
          max={MAX_SLAB_MM}
          step={1}
          value={[thickness]}
          onValueChange={([mm]) => run(state.mode, mm)}
          aria-label="Grosor de la proyección en milímetros"
        />
      </div>
    </div>
  );
}
