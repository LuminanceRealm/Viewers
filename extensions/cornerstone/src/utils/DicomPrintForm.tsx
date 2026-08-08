import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getEnabledElement } from '@cornerstonejs/core';
import { getEnabledElement as OHIFgetEnabledElement } from '../state';
import { useSystem } from '@ohif/core/src';
import { classes } from '@ohif/core';
import {
  disableOffscreenViewport,
  enableOffscreenViewport,
  loadActiveImage,
  rasterizeViewport,
  syncAnnotations,
} from './viewportRasterizer';
import { canvasToGrayscalePng } from './grayscalePng';
import {
  getPrintJobStatus,
  listPrinters,
  studyIdFor,
  submitPrintJob,
  type NubixPrinter,
} from './nubixPrintApi';

const VIEWPORT_ID = 'cornerstone-viewport-dicom-print';
const PREVIEW_SIZE = 512;

// Tamaño de celda de película: ~150 dpi sobre 14x17 in. Es la resolución a la
// que se rasteriza para imprimir, no la del preview.
const PRINT_CELL_SIZE = 2048;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

const LAYOUTS = [
  { value: 'STANDARD\\1,1', label: '1 imagen (1x1)' },
  { value: 'STANDARD\\2,2', label: '4 imágenes (2x2)' },
];

type Phase = 'form' | 'sending' | 'waiting' | 'done' | 'error';

type DicomPrintFormProps = {
  hide: () => void;
  activeViewportId: string;
};

const DicomPrintForm = ({ hide, activeViewportId: activeViewportIdProp }: DicomPrintFormProps) => {
  const { servicesManager } = useSystem();
  const { customizationService, cornerstoneViewportService, userAuthenticationService } =
    servicesManager.services;

  const [printers, setPrinters] = useState<NubixPrinter[]>([]);
  const [printerId, setPrinterId] = useState<number | null>(null);
  const [layout, setLayout] = useState(LAYOUTS[0].value);
  const [copies, setCopies] = useState(1);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [phase, setPhase] = useState<Phase>('form');
  const [message, setMessage] = useState('');

  const cancelled = useRef(false);

  const refViewportEnabledElementOHIF = OHIFgetEnabledElement(activeViewportIdProp);
  const activeViewportElement = refViewportEnabledElementOHIF?.element;
  const renderingEngine = cornerstoneViewportService.getRenderingEngine();

  const studyId = (() => {
    const enabled = activeViewportElement && getEnabledElement(activeViewportElement);
    const imageId = enabled?.viewport?.getCurrentImageId?.();
    const uids = imageId && classes.MetadataProvider.getUIDsFromImageID(imageId);
    return uids?.StudyInstanceUID ? studyIdFor(uids.StudyInstanceUID) : null;
  })();

  const authHeader = userAuthenticationService.getAuthorizationHeader();

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    if (!studyId || !authHeader?.Authorization) {
      setPhase('error');
      setMessage('La impresión sólo está disponible desde una sesión con inicio de sesión.');
      return;
    }

    listPrinters(studyId, authHeader)
      .then(list => {
        if (cancelled.current) {
          return;
        }
        setPrinters(list);
        if (list.length > 0) {
          setPrinterId(list[0].id);
          setLayout(list[0].default_layout || LAYOUTS[0].value);
        } else {
          setPhase('error');
          setMessage('No hay impresoras DICOM configuradas para esta organización.');
        }
      })
      .catch(() => {
        if (cancelled.current) {
          return;
        }
        setPhase('error');
        setMessage('No se pudo consultar la lista de impresoras.');
      });
  }, [studyId]);

  const handleEnableViewport = useCallback(
    (element: HTMLElement) => {
      enableOffscreenViewport(renderingEngine, activeViewportElement, VIEWPORT_ID, element);
    },
    [renderingEngine, activeViewportElement]
  );

  const handleDisableViewport = useCallback(() => {
    disableOffscreenViewport(renderingEngine, VIEWPORT_ID);
  }, [renderingEngine]);

  useEffect(() => {
    if (phase !== 'form') {
      return;
    }
    const timer = setTimeout(() => {
      void loadActiveImage(
        renderingEngine,
        activeViewportElement,
        VIEWPORT_ID,
        PREVIEW_SIZE,
        PREVIEW_SIZE,
        PREVIEW_SIZE
      );
      syncAnnotations(renderingEngine, activeViewportElement, VIEWPORT_ID, showAnnotations);
    }, 100);

    return () => clearTimeout(timer);
  }, [phase, showAnnotations, renderingEngine, activeViewportElement]);

  const waitForJob = async (jobId: number): Promise<void> => {
    const startedAt = Date.now();

    for (;;) {
      if (cancelled.current) {
        return;
      }

      const status = await getPrintJobStatus(studyId!, jobId, authHeader);

      if (status.status === 'done') {
        setPhase('done');
        setMessage(
          status.printer_status_info
            ? `La impresora respondió: ${status.printer_status_info}`
            : 'El estudio se envió a la impresora.'
        );
        return;
      }

      if (status.status === 'failed') {
        setPhase('error');
        setMessage(status.error || 'La impresora rechazó el trabajo.');
        return;
      }

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setPhase('error');
        setMessage(
          'El agente local no respondió. Verifique que NUBIX OS esté corriendo en la clínica.'
        );
        return;
      }

      setMessage(status.status === 'printing' ? 'Imprimiendo…' : 'En cola…');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  const handlePrint = async () => {
    if (!printerId || !studyId) {
      return;
    }

    setPhase('sending');
    setMessage('Preparando la imagen…');

    try {
      // Se rasteriza a resolución de película, no a la del preview
      await loadActiveImage(
        renderingEngine,
        activeViewportElement,
        VIEWPORT_ID,
        PRINT_CELL_SIZE,
        PRINT_CELL_SIZE,
        PRINT_CELL_SIZE
      );
      syncAnnotations(renderingEngine, activeViewportElement, VIEWPORT_ID, showAnnotations);
      await new Promise(resolve => setTimeout(resolve, 300));

      const canvas = await rasterizeViewport(VIEWPORT_ID);
      if (!canvas) {
        throw new Error('No se pudo capturar la imagen del viewport.');
      }

      const blob = await canvasToGrayscalePng(canvas);
      const printer = printers.find(candidate => candidate.id === printerId);

      setMessage('Enviando a la cola de impresión…');

      const { id } = await submitPrintJob(
        studyId,
        authHeader,
        {
          printer_id: printerId,
          layout,
          copies,
          film_size_id: printer?.film_size_id,
          medium_type: printer?.medium_type,
          film_orientation: printer?.film_orientation,
          pages: [{ width: canvas.width, height: canvas.height, content_type: 'image/png' }],
        },
        [blob]
      );

      setPhase('waiting');
      await waitForJob(id);
    } catch (error) {
      if (cancelled.current) {
        return;
      }
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la impresión.');
    }
  };

  const DicomPrintModal = customizationService.getCustomization('nubix.dicomPrintModal');

  return (
    <DicomPrintModal
      onClose={hide}
      viewportId={VIEWPORT_ID}
      previewSize={PREVIEW_SIZE}
      printers={printers}
      printerId={printerId}
      onPrinterChange={setPrinterId}
      layouts={LAYOUTS}
      layout={layout}
      onLayoutChange={setLayout}
      copies={copies}
      onCopiesChange={setCopies}
      showAnnotations={showAnnotations}
      onAnnotationsChange={setShowAnnotations}
      onEnableViewport={handleEnableViewport}
      onDisableViewport={handleDisableViewport}
      onPrint={handlePrint}
      phase={phase}
      message={message}
    />
  );
};

export default DicomPrintForm;
