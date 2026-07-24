import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@ohif/ui-next';

export type VertebralStart = {
  startLabel: string;
  direction: 'up' | 'down';
};

type VertebralLabelStartDialogProps = {
  hide: () => void;
  onSave: (value: VertebralStart | null) => void;
  labels: string[];
  defaultLabel: string;
  defaultDirection: 'up' | 'down';
};

/**
 * Asks which vertebra the count starts at and in which direction it continues.
 * Closing the dialog without confirming resolves to null, which drops the
 * annotation the click created.
 */
function VertebralLabelStartDialog({
  hide,
  onSave,
  labels,
  defaultLabel,
  defaultDirection,
}: VertebralLabelStartDialogProps) {
  const [startLabel, setStartLabel] = useState(defaultLabel);
  const [direction, setDirection] = useState<'up' | 'down'>(defaultDirection);

  // Resolve on unmount too, so an Esc/overlay close does not leave the caller
  // waiting forever on an empty annotation.
  const settled = useRef(false);
  useEffect(() => {
    return () => {
      if (!settled.current) {
        onSave(null);
      }
    };
  }, [onSave]);

  const confirm = () => {
    settled.current = true;
    onSave({ startLabel, direction });
    hide();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-sm">Vértebra inicial</span>
        <Select
          value={startLabel}
          onValueChange={setStartLabel}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {labels.map(label => (
              <SelectItem
                key={label}
                value={label}
              >
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-sm">Dirección del conteo</span>
        <ToggleGroup
          type="single"
          value={direction}
          onValueChange={value => value && setDirection(value as 'up' | 'down')}
        >
          <ToggleGroupItem
            value="up"
            className="flex-1"
          >
            ↑ Hacia arriba
          </ToggleGroupItem>
          <ToggleGroupItem
            value="down"
            className="flex-1"
          >
            ↓ Hacia abajo
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={hide}
        >
          Cancelar
        </Button>
        <Button onClick={confirm}>Iniciar conteo</Button>
      </div>
    </div>
  );
}

export default VertebralLabelStartDialog;
