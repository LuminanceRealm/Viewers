import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/**
 * Visor de PDF propio con pdf.js: cada página se rasteriza a un canvas y se
 * apilan en una columna desplazable. Sustituye al <object> del navegador donde
 * éste no pagina el documento (Safari en iOS) o no tiene lector integrado
 * (Chrome en Android).
 *
 * pdf.js se importa de forma diferida para que su chunk (~350 KB) sólo baje
 * cuando se abre un documento. El worker se copia a la raíz del `dist`
 * (`pdf.worker.min.mjs`) desde el webpack de la app.
 */

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MAX_DPR = 2;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(pdfjs => {
      const base = process.env.PUBLIC_URL || '/';
      pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

interface PageProps {
  page: PDFPageProxy;
  /** Píxeles CSS de ancho disponibles para la página. */
  width: number;
}

function PdfPage({ page, width }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = width / baseViewport.width;
  const height = Math.round(baseViewport.height * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new IntersectionObserver(
      entries => setVisible(entries.some(e => e.isIntersecting)),
      { rootMargin: '600px 0px' }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || width <= 0) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const task = page.render({ canvasContext: context, viewport });
    task.promise.catch(error => {
      if (error?.name !== 'RenderingCancelledException') {
        console.warn('PdfPages: no se pudo pintar la página', page.pageNumber, error);
      }
    });
    return () => task.cancel();
  }, [page, scale, visible, width]);

  return (
    <canvas
      ref={canvasRef}
      className="block bg-white shadow-md"
      style={{ width, height }}
      data-page={page.pageNumber}
    />
  );
}

interface PdfPagesProps {
  url: string;
  title?: string;
}

export default function PdfPages({ url, title }: PdfPagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(ZOOM_STEPS.indexOf(1));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setPages([]);
    setError(null);
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        doc = await pdfjs.getDocument({ url }).promise;
        const loaded = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
        );
        if (!cancelled) {
          setPages(loaded);
        }
      } catch (e) {
        console.error('PdfPages: no se pudo abrir el PDF', e);
        if (!cancelled) {
          setError('No se pudo abrir el documento.');
        }
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [url]);

  const zoom = ZOOM_STEPS[zoomIndex];
  const gutter = 16;
  const pageWidth = Math.max(0, Math.floor((containerWidth - gutter * 2) * zoom));

  const zoomBy = useCallback((delta: number) => {
    setZoomIndex(i => Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta)));
  }, []);

  return (
    <div
      className="bg-primary-black flex h-full w-full flex-col text-white"
      data-cy="pdf-pages-viewer"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {title}
          {pages.length ? ` · ${pages.length} pág.` : ''}
        </span>
        <button
          type="button"
          className="bg-secondary-dark hover:bg-accent h-7 w-7 rounded text-base leading-none disabled:opacity-40"
          onClick={() => zoomBy(-1)}
          disabled={zoomIndex === 0}
          aria-label="Reducir"
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)} %</span>
        <button
          type="button"
          className="bg-secondary-dark hover:bg-accent h-7 w-7 rounded text-base leading-none disabled:opacity-40"
          onClick={() => zoomBy(1)}
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          aria-label="Ampliar"
        >
          +
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-light hover:underline"
        >
          Abrir
        </a>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto"
        style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {error ? (
          <p className="text-muted-foreground p-6 text-center text-sm">{error}</p>
        ) : !pages.length ? (
          <p className="text-muted-foreground p-6 text-center text-sm">Cargando documento…</p>
        ) : (
          <div
            className="flex flex-col items-start gap-3 py-3"
            style={{ paddingLeft: gutter, paddingRight: gutter, minWidth: 'max-content' }}
          >
            {pages.map(page => (
              <PdfPage
                key={page.pageNumber}
                page={page}
                width={pageWidth}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
