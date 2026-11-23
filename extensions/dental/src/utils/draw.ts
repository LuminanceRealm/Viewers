import {
  CURSOR_COLOR,
  NERVE_MARK_RADIUS_MM,
  NERVES,
  RULER_COLOR,
  SAME_SECTION_TOLERANCE_MM,
} from '../constants';
import type { Arch } from './archGeometry';
import { nerveAtS } from './archGeometry';
import { Overlays, Section, cToViewY, oToSectionX, sToPanoX } from './model';
import { Raster, WindowLevel, toRgba } from './reslice';
import type { VolumeGrid } from './volumeGrid';

/** Dónde cae una vista (en mm) dentro del lienzo (en píxeles). */
export interface Fit {
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Encaja mmW × mmH dentro de la caja, centrado y sin deformar. */
export function fitBox(
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  mmW: number,
  mmH: number
): Fit {
  const scale = Math.max(1e-6, Math.min(boxW / mmW, boxH / mmH));
  const w = mmW * scale;
  const h = mmH * scale;
  return { scale, x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

export const toPx = (fit: Fit, mmX: number, mmY: number): [number, number] => [
  fit.x + mmX * fit.scale,
  fit.y + mmY * fit.scale,
];

export const toMm = (fit: Fit, pxX: number, pxY: number): [number, number] => [
  (pxX - fit.x) / fit.scale,
  (pxY - fit.y) / fit.scale,
];

export const insideFit = (fit: Fit, pxX: number, pxY: number) =>
  pxX >= fit.x && pxX <= fit.x + fit.w && pxY >= fit.y && pxY <= fit.y + fit.h;

/** La imagen reconstruida, ya con ventana, en un lienzo a su resolución nativa. */
export function rasterToCanvas(raster: Raster, wl: WindowLevel): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  const rgba = toRgba(raster, wl);
  ctx.putImageData(new ImageData(rgba, raster.width, raster.height), 0, 0);
  return canvas;
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
  fontPx = 11
) {
  ctx.save();
  ctx.font = `${fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function ruler(
  ctx: CanvasRenderingContext2D,
  p: [number, number],
  q: [number, number],
  text: string,
  k: number
) {
  ctx.save();
  ctx.strokeStyle = RULER_COLOR;
  ctx.lineWidth = 1.25 * k;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(q[0], q[1]);
  ctx.stroke();
  dot(ctx, p[0], p[1], 2.5 * k, RULER_COLOR);
  dot(ctx, q[0], q[1], 2.5 * k, RULER_COLOR);
  ctx.restore();
  label(ctx, text, Math.max(p[0], q[0]) + 6 * k, (p[1] + q[1]) / 2, RULER_COLOR, 'left', 11 * k);
}

/** Barra de 10 mm: lo único que sigue siendo cierto si la hoja se imprime a otra escala. */
function scaleBar(ctx: CanvasRenderingContext2D, fit: Fit, k: number) {
  const length = 10 * fit.scale;
  const x = fit.x + 8 * k;
  const y = fit.y + fit.h - 10 * k;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.moveTo(x, y - 3 * k);
  ctx.lineTo(x, y);
  ctx.lineTo(x + length, y);
  ctx.lineTo(x + length, y - 3 * k);
  ctx.stroke();
  ctx.restore();
  label(ctx, '10 mm', x + length + 5 * k, y - 1 * k, 'rgba(255, 255, 255, 0.75)', 'left', 10 * k);
}

function drawBitmap(ctx: CanvasRenderingContext2D, bitmap: HTMLCanvasElement, fit: Fit) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, fit.x, fit.y, fit.w, fit.h);
}

export interface PanoDrawing {
  grid: VolumeGrid;
  arch: Arch;
  bitmap: HTMLCanvasElement;
  overlays: Overlays;
  /** Posiciones de los cortes transversales; el del centro es el cursor. */
  sectionS: (number | null)[];
  cursorS: number;
  /** Factor de tamaño de trazos y texto (1 en pantalla; mayor al imprimir). */
  k?: number;
}

export function drawPano(ctx: CanvasRenderingContext2D, fit: Fit, d: PanoDrawing): void {
  const k = d.k ?? 1;
  const { grid, arch, overlays } = d;
  drawBitmap(ctx, d.bitmap, fit);

  ctx.save();
  ctx.beginPath();
  ctx.rect(fit.x, fit.y, fit.w, fit.h);
  ctx.clip();

  // Cortes transversales: el central de lado a lado, los demás como marcas.
  d.sectionS.forEach(s => {
    if (s === null) {
      return;
    }
    const x = fit.x + sToPanoX(arch, s) * fit.scale;
    const isCursor = Math.abs(s - d.cursorS) < 1e-6;
    ctx.strokeStyle = CURSOR_COLOR;
    ctx.globalAlpha = isCursor ? 0.7 : 0.45;
    ctx.lineWidth = k;
    ctx.beginPath();
    if (isCursor) {
      ctx.moveTo(x, fit.y);
      ctx.lineTo(x, fit.y + fit.h);
    } else {
      ctx.moveTo(x, fit.y);
      ctx.lineTo(x, fit.y + 7 * k);
      ctx.moveTo(x, fit.y + fit.h - 7 * k);
      ctx.lineTo(x, fit.y + fit.h);
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  NERVES.forEach(nerve => {
    const path = overlays.nervePaths[nerve.id];
    if (path.length >= 2) {
      ctx.strokeStyle = nerve.color;
      ctx.lineWidth = 1.75 * k;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      path.forEach((p, i) => {
        const [x, y] = toPx(fit, sToPanoX(arch, p.s), cToViewY(grid, p.c));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    overlays.nervePoints[nerve.id].forEach(p => {
      const [x, y] = toPx(fit, sToPanoX(arch, p.s), cToViewY(grid, p.c));
      dot(ctx, x, y, 2.25 * k, nerve.color);
    });
  });

  overlays.rulers
    .filter(r => r.view === 'pano')
    .forEach(r => {
      ruler(
        ctx,
        toPx(fit, sToPanoX(arch, r.p.s), cToViewY(grid, r.p.c)),
        toPx(fit, sToPanoX(arch, r.q.s), cToViewY(grid, r.q.c)),
        `${r.lengthMm.toFixed(1)} mm`,
        k
      );
    });
  if (overlays.pending?.view === 'pano') {
    const { p } = overlays.pending;
    const [x, y] = toPx(fit, sToPanoX(arch, p.s), cToViewY(grid, p.c));
    dot(ctx, x, y, 3 * k, RULER_COLOR);
  }
  ctx.restore();

  const dim = 'rgba(255, 255, 255, 0.7)';
  label(ctx, 'R', fit.x + 8 * k, fit.y + 12 * k, dim, 'left', 12 * k);
  label(ctx, 'L', fit.x + fit.w - 8 * k, fit.y + 12 * k, dim, 'right', 12 * k);
  scaleBar(ctx, fit, k);
}

export interface SectionDrawing {
  grid: VolumeGrid;
  section: Section;
  bitmap: HTMLCanvasElement | null;
  widthMm: number;
  pixelMm: number;
  overlays: Overlays;
  isCursor: boolean;
  showScaleBar: boolean;
  k?: number;
}

export function drawSection(ctx: CanvasRenderingContext2D, fit: Fit, d: SectionDrawing): void {
  const k = d.k ?? 1;
  const { grid, section, overlays } = d;
  const dim = 'rgba(255, 255, 255, 0.7)';

  ctx.fillStyle = '#000';
  ctx.fillRect(fit.x, fit.y, fit.w, fit.h);
  if (section.s === null || !d.bitmap) {
    // Corte más allá del extremo del arco: el hueco se deja a la vista.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = k;
    ctx.strokeRect(fit.x + 0.5, fit.y + 0.5, fit.w - 1, fit.h - 1);
    return;
  }
  drawBitmap(ctx, d.bitmap, fit);
  const s = section.s;
  const px = (o: number, c: number) =>
    toPx(fit, oToSectionX(d.widthMm, d.pixelMm, o), cToViewY(grid, c));

  ctx.save();
  ctx.beginPath();
  ctx.rect(fit.x, fit.y, fit.w, fit.h);
  ctx.clip();

  NERVES.forEach(nerve => {
    const at = nerveAtS(overlays.nervePaths[nerve.id], s);
    if (at) {
      const [x, y] = px(at.o, at.c);
      ctx.strokeStyle = nerve.color;
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.arc(x, y, NERVE_MARK_RADIUS_MM * fit.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    overlays.nervePoints[nerve.id].forEach(p => {
      if (Math.abs(p.s - s) <= SAME_SECTION_TOLERANCE_MM) {
        const [x, y] = px(p.o, p.c);
        dot(ctx, x, y, 2.5 * k, nerve.color);
      }
    });
  });

  overlays.rulers
    .filter(
      r =>
        r.view === 'cross' &&
        r.sectionS !== null &&
        Math.abs(r.sectionS - s) <= SAME_SECTION_TOLERANCE_MM
    )
    .forEach(r => ruler(ctx, px(r.p.o, r.p.c), px(r.q.o, r.q.c), `${r.lengthMm.toFixed(1)} mm`, k));
  const pending = overlays.pending;
  if (
    pending?.view === 'cross' &&
    pending.sectionS !== null &&
    Math.abs(pending.sectionS - s) <= SAME_SECTION_TOLERANCE_MM
  ) {
    const [x, y] = px(pending.p.o, pending.p.c);
    dot(ctx, x, y, 3 * k, RULER_COLOR);
  }
  ctx.restore();

  if (d.isCursor) {
    ctx.strokeStyle = CURSOR_COLOR;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = k;
    ctx.strokeRect(fit.x + 0.5, fit.y + 0.5, fit.w - 1, fit.h - 1);
    ctx.globalAlpha = 1;
  }
  label(ctx, String(section.number), fit.x + 6 * k, fit.y + 11 * k, dim, 'left', 11 * k);
  label(ctx, 'V', fit.x + 6 * k, fit.y + fit.h - 24 * k, dim, 'left', 10 * k);
  label(ctx, 'L', fit.x + fit.w - 6 * k, fit.y + fit.h - 24 * k, dim, 'right', 10 * k);
  if (d.showScaleBar) {
    scaleBar(ctx, fit, k);
  }
}
