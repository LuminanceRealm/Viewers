import React, { useEffect, useState } from 'react';
import {
  Button,
  Icons,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useViewportGrid,
} from '@ohif/ui-next';

import { SlabProjection } from './WindowLevelActionMenu/SlabProjection';
import { getSlabState, isSlabCapable, SLAB_MODIFIED_EVENT } from '../utils/slabProjection';

/**
 * NUBIX: control de la barra para MIP/MinIP/promedio. Sólo existe mientras la
 * vista activa es un plano MPR; fuera de ahí no ocupa sitio. Al pulsarlo abre
 * un panel con el modo y el grosor, el mismo contenido que el submenú del
 * viewport.
 */
export default function ToolbarSlabProjection({ servicesManager, commandsManager }: withAppTypes) {
  const { cornerstoneViewportService, hangingProtocolService } = servicesManager.services;
  const [{ activeViewportId }] = useViewportGrid();
  const [, setRevision] = useState(0);

  // El tipo de viewport cambia al entrar o salir del MPR sin que cambie el id activo.
  useEffect(() => {
    const bump = () => setRevision(r => r + 1);
    const subs = [
      cornerstoneViewportService.subscribe(
        cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
        bump
      ),
      hangingProtocolService.subscribe(hangingProtocolService.EVENTS.PROTOCOL_CHANGED, bump),
    ];
    return () => subs.forEach(s => s.unsubscribe());
  }, [cornerstoneViewportService, hangingProtocolService]);

  const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

  useEffect(() => {
    const element = viewport?.element;
    const bump = () => setRevision(r => r + 1);
    element?.addEventListener(SLAB_MODIFIED_EVENT, bump);
    return () => element?.removeEventListener(SLAB_MODIFIED_EVENT, bump);
  }, [viewport]);

  if (!isSlabCapable(viewport)) {
    return null;
  }

  const { mode } = getSlabState(viewport);
  const isActive = mode !== 'off';

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-cy="SlabProjection">
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Proyección de grosor (MIP)"
                className={`inline-flex h-10 w-10 items-center justify-center !rounded-lg ${
                  isActive
                    ? 'bg-highlight text-background hover:!bg-highlight/80'
                    : 'text-foreground/80 hover:bg-background hover:text-highlight bg-transparent'
                }`}
              >
                <Icons.ByName
                  name="tool-slab"
                  className="h-7 w-7"
                />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Proyección de grosor (MIP, MinIP, promedio)</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="bg-secondary-dark w-64 border-none p-0"
      >
        <div className="text-aqua-pale px-3 pt-2 text-xs">Proyección de grosor</div>
        <SlabProjection
          key={activeViewportId}
          viewportId={activeViewportId}
          commandsManager={commandsManager}
          servicesManager={servicesManager}
        />
      </PopoverContent>
    </Popover>
  );
}
