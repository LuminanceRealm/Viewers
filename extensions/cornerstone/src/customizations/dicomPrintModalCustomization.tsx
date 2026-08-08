import React, { useEffect, useState } from 'react';
import { ImageModal, FooterAction } from '@ohif/ui-next';

interface Layout {
  value: string;
  label: string;
}

interface Printer {
  id: number;
  name: string;
  description?: string;
}

interface DicomPrintModalProps {
  onClose: () => void;
  viewportId: string;
  previewSize: number;
  printers: Printer[];
  printerId: number | null;
  onPrinterChange: (id: number) => void;
  layouts: Layout[];
  layout: string;
  onLayoutChange: (layout: string) => void;
  copies: number;
  onCopiesChange: (copies: number) => void;
  showAnnotations: boolean;
  onAnnotationsChange: (show: boolean) => void;
  onEnableViewport: (element: HTMLElement) => void;
  onDisableViewport: () => void;
  onPrint: () => void;
  phase: 'form' | 'sending' | 'waiting' | 'done' | 'error';
  message: string;
}

function DicomPrintModal({
  onClose,
  viewportId,
  previewSize,
  printers,
  printerId,
  onPrinterChange,
  layouts,
  layout,
  onLayoutChange,
  copies,
  onCopiesChange,
  showAnnotations,
  onAnnotationsChange,
  onEnableViewport,
  onDisableViewport,
  onPrint,
  phase,
  message,
}: DicomPrintModalProps) {
  const [viewportElement, setViewportElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!viewportElement) {
      return;
    }

    onEnableViewport(viewportElement);

    return () => {
      onDisableViewport();
    };
  }, [onDisableViewport, onEnableViewport, viewportElement]);

  const busy = phase === 'sending' || phase === 'waiting';
  const finished = phase === 'done' || phase === 'error';

  return (
    <ImageModal>
      <ImageModal.Body>
        <ImageModal.ImageVisual>
          <div
            style={{ height: previewSize, width: previewSize, position: 'relative' }}
            data-viewport-uid={viewportId}
            ref={setViewportElement}
          />
        </ImageModal.ImageVisual>

        <ImageModal.ImageOptions>
          <div className="flex flex-col space-y-3">
            <label className="text-foreground flex flex-col text-sm">
              Impresora
              <select
                className="bg-background text-foreground mt-1 rounded border p-2"
                value={printerId ?? ''}
                disabled={busy || printers.length === 0}
                onChange={event => onPrinterChange(parseInt(event.target.value, 10))}
              >
                {printers.map(printer => (
                  <option
                    key={printer.id}
                    value={printer.id}
                  >
                    {printer.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-foreground flex flex-col text-sm">
              Formato
              <select
                className="bg-background text-foreground mt-1 rounded border p-2"
                value={layout}
                disabled={busy}
                onChange={event => onLayoutChange(event.target.value)}
              >
                {layouts.map(option => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-foreground flex flex-col text-sm">
              Copias
              <input
                className="bg-background text-foreground mt-1 rounded border p-2"
                type="number"
                min={1}
                max={20}
                value={copies}
                disabled={busy}
                onChange={event => onCopiesChange(parseInt(event.target.value, 10) || 1)}
              />
            </label>
          </div>

          <ImageModal.SwitchOption
            defaultChecked={showAnnotations}
            checked={showAnnotations}
            onCheckedChange={onAnnotationsChange}
          >
            Incluir anotaciones
          </ImageModal.SwitchOption>

          {message && (
            <div
              className={`mt-2 text-sm ${phase === 'error' ? 'text-red-500' : 'text-muted-foreground'}`}
            >
              {message}
            </div>
          )}

          <FooterAction className="mt-2">
            <FooterAction.Right>
              <FooterAction.Secondary onClick={onClose}>
                {finished ? 'Cerrar' : 'Cancelar'}
              </FooterAction.Secondary>
              {!finished && (
                <FooterAction.Primary
                  disabled={busy || !printerId}
                  onClick={onPrint}
                >
                  {busy ? 'Enviando…' : 'Imprimir'}
                </FooterAction.Primary>
              )}
            </FooterAction.Right>
          </FooterAction>
        </ImageModal.ImageOptions>
      </ImageModal.Body>
    </ImageModal>
  );
}

export default {
  'nubix.dicomPrintModal': DicomPrintModal,
};
