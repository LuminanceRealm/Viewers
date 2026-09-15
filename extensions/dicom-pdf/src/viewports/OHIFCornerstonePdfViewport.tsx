import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import './OHIFCornerstonePdfViewport.css';
import PdfPages from './PdfPages';

/**
 * Safari en iPhone/iPad no pagina ni escala un PDF embebido en <object>:
 * pinta la primera página a tamaño intrínseco, minúscula. Chrome en Android
 * ni siquiera tiene visor integrado (`navigator.pdfViewerEnabled` es false).
 * En esos casos el documento se pagina con pdf.js dentro del viewport.
 */
function needsOwnPdfViewer(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) &&
      typeof navigator.maxTouchPoints === 'number' &&
      navigator.maxTouchPoints > 1);
  const noInlineViewer = (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled === false;
  return isIOS || noInlineViewer;
}

function OHIFCornerstonePdfViewport({ displaySets }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    document.body.addEventListener('drag', makePdfDropTarget);
    return function cleanup() {
      document.body.removeEventListener('drag', makePdfDropTarget);
    };
  }, []);

  const [style, setStyle] = useState('pdf-yes-click');

  const makePdfScrollable = () => {
    setStyle('pdf-yes-click');
  };

  const makePdfDropTarget = () => {
    setStyle('pdf-no-click');
  };

  if (displaySets && displaySets.length > 1) {
    throw new Error(
      'OHIFCornerstonePdfViewport: only one display set is supported for dicom pdf right now'
    );
  }

  const { pdfUrl, SeriesDescription } = displaySets[0];

  useEffect(() => {
    const load = async () => {
      setUrl(await pdfUrl);
    };

    load();
  }, [pdfUrl]);

  if (needsOwnPdfViewer()) {
    if (!url) {
      return (
        <div className="bg-primary-black text-muted-foreground flex h-full w-full items-center justify-center text-sm">
          Preparando…
        </div>
      );
    }
    return (
      <PdfPages
        url={url}
        title={SeriesDescription || 'Documento PDF'}
      />
    );
  }

  return (
    <div
      className="bg-primary-black h-full w-full text-white"
      onClick={makePdfScrollable}
    >
      <object
        data={url}
        type="application/pdf"
        className={style}
      >
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted-foreground text-sm">
            Este navegador no puede mostrar el PDF aquí.
          </p>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary rounded px-5 py-2 text-sm font-medium text-white"
            >
              Abrir PDF
            </a>
          )}
        </div>
      </object>
    </div>
  );
}

OHIFCornerstonePdfViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object).isRequired,
};

export default OHIFCornerstonePdfViewport;
