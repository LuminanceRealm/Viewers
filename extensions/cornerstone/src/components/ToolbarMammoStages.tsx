import React, { useEffect, useState } from 'react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@ohif/ui-next';

import { MAMMO_MIRROR_PROTOCOL_ID } from '../utils/mammoMirror/hpMammoMirror';

const STAGES = [
  { label: '4', tooltip: 'Las cuatro proyecciones' },
  { label: 'CC', tooltip: 'Par craneocaudal en espejo' },
  { label: 'MLO', tooltip: 'Par oblicuo mediolateral en espejo' },
];

/**
 * NUBIX: etapas de la lectura en espejo de mamografía. Sólo existe mientras el
 * protocolo activo es el de mamografía; en cualquier otro estudio no ocupa
 * sitio en la barra. Las teclas "." y "," recorren las mismas etapas.
 */
export default function ToolbarMammoStages({ servicesManager, commandsManager }: withAppTypes) {
  const { hangingProtocolService } = servicesManager.services;
  const [, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision(r => r + 1);
    const subs = [
      hangingProtocolService.subscribe(hangingProtocolService.EVENTS.PROTOCOL_CHANGED, bump),
      hangingProtocolService.subscribe(hangingProtocolService.EVENTS.PROTOCOL_RESTORED, bump),
    ];
    return () => subs.forEach(s => s.unsubscribe());
  }, [hangingProtocolService]);

  const { protocol, stageIndex } = hangingProtocolService.getActiveProtocol();
  if (protocol?.id !== MAMMO_MIRROR_PROTOCOL_ID) {
    return null;
  }

  const goTo = (index: number) =>
    commandsManager.run('setHangingProtocol', {
      protocolId: MAMMO_MIRROR_PROTOCOL_ID,
      stageIndex: index,
    });

  // En teléfono no caben tres botones en la barra: uno solo muestra la etapa
  // actual y cada toque pasa a la siguiente.
  if (window.innerWidth <= 768) {
    const current = STAGES[stageIndex] ?? STAGES[0];
    return (
      <Button
        variant="ghost"
        data-cy="MammoStages"
        aria-label={`${current.tooltip}; tocar para cambiar`}
        className="bg-highlight text-background hover:!bg-highlight/80 min-w-10 h-10 !rounded-lg px-2 text-sm font-semibold"
        onClick={() => goTo((stageIndex + 1) % STAGES.length)}
      >
        {current.label}
      </Button>
    );
  }

  return (
    <div
      className="flex items-center gap-0.5"
      data-cy="MammoStages"
    >
      {STAGES.map(({ label, tooltip }, index) => {
        const isActive = index === stageIndex;
        return (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                aria-label={tooltip}
                aria-pressed={isActive}
                className={`min-w-10 h-10 !rounded-lg px-2 text-sm font-semibold ${
                  isActive
                    ? 'bg-highlight text-background hover:!bg-highlight/80'
                    : 'text-foreground/60 hover:bg-background hover:text-highlight bg-transparent'
                }`}
                onClick={() => goTo(index)}
              >
                {label}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
