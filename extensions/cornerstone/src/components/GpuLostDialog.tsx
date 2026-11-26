import React from 'react';
import { FooterAction } from '@ohif/ui-next';

export type GpuLostDialogProps = {
  /** Cortes de la reconstrucción que estaba cargada; 0 si no había ninguna. */
  slices: number;
  /** Cortes de la serie completa (igual a `slices` si no era ya parcial). */
  totalSlices: number;
  columns?: number;
  rows?: number;
  megabytes?: number;
  /** Cortes que se ofrecen al recargar; 0 si ya no tiene caso ofrecer menos. */
  fewerSlices: number;
  onReload: () => void;
  onReloadWithFewer: () => void;
};

/**
 * NUBIX: lo que ve el usuario cuando el navegador le quita el contexto WebGL a
 * cornerstone (watchWebGLContextLoss). Es un diálogo y no un toast porque la
 * imagen ya no responde: no hay nada que seguir haciendo detrás, y el toast
 * rojo de sonner, con dos botones, se plegaba en una columna angosta ilegible.
 */
export default function GpuLostDialog({
  slices,
  totalSlices,
  columns,
  rows,
  megabytes,
  fewerSlices,
  onReload,
  onReloadWithFewer,
}: GpuLostDialogProps) {
  const percent = totalSlices ? Math.round((fewerSlices / totalSlices) * 100) : 0;

  return (
    <div className="text-foreground flex flex-col gap-3">
      <p className="text-base leading-snug">
        {slices
          ? `Este equipo no pudo sostener la reconstrucción de ${slices} cortes. `
          : 'Este equipo perdió la conexión con su tarjeta gráfica. '}
        Las imágenes en pantalla ya no se actualizan: hay que recargar la página.
      </p>

      {fewerSlices > 0 && (
        <div className="border-input bg-muted/40 rounded border px-3 py-2">
          <p className="text-base leading-snug">
            Puedes reconstruir{' '}
            <span className="text-primary font-semibold">
              {fewerSlices} de {totalSlices} cortes
            </span>{' '}
            ({percent} %), alrededor del corte que estés viendo.
          </p>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            A resolución completa: las mediciones siguen siendo exactas, pero la reconstrucción no
            abarca toda la serie.
          </p>
        </div>
      )}

      {slices > 0 && (
        <p className="text-muted-foreground text-xs">
          {columns} × {rows} px por corte · ~{megabytes} MB de memoria de video
        </p>
      )}

      <FooterAction className="mt-1">
        <FooterAction.Right>
          {fewerSlices > 0 ? (
            <>
              <FooterAction.Secondary onClick={onReload}>Recargar completa</FooterAction.Secondary>
              <FooterAction.Primary onClick={onReloadWithFewer}>
                Reconstruir {fewerSlices} cortes
              </FooterAction.Primary>
            </>
          ) : (
            <FooterAction.Primary onClick={onReload}>Recargar</FooterAction.Primary>
          )}
        </FooterAction.Right>
      </FooterAction>
    </div>
  );
}
