import React, { useState, useEffect } from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../Dialog/Dialog';
import { ScrollArea } from '../ScrollArea/ScrollArea';
import { Icons } from '../Icons';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * NUBIX: datos de la GPU (platform/app/src/utils/probeGpu.ts) y, si la hubo,
 * de la pérdida de contexto WebGL (watchWebGLContextLoss en la extensión de
 * cornerstone). Van en el detalle para que un reporte de "pantalla en blanco"
 * llegue con lo que de otro modo habría que pedir de chrome://gpu.
 */
const getGpuDetails = (): string => {
  const { nubixGpuInfo, nubixContextLoss } = window as unknown as Record<string, unknown>;
  const lines = [`GPU: ${JSON.stringify(nubixGpuInfo ?? null)}`];

  if (nubixContextLoss) {
    lines.push(`WebGL context lost: ${JSON.stringify(nubixContextLoss)}`);
  }

  return lines.join('\n');
};

interface ErrorBoundaryError extends Error {
  message: string;
  stack?: string;
}

interface DefaultFallbackProps {
  error: ErrorBoundaryError;
  context: string;
  resetErrorBoundary: () => void;
}

interface ErrorBoundaryProps {
  context?: string;
  onReset?: () => void;
  onError?: (error: ErrorBoundaryError, componentStack: string, context: string) => void;
  fallbackComponent?: React.ComponentType<DefaultFallbackProps>;
  children: React.ReactNode;
  fallbackRoute?: string | null;
  isPage?: boolean;
}

const DefaultFallback = ({
  error,
  context,
  resetErrorBoundary = () => {},
}: DefaultFallbackProps) => {
  const { t } = useTranslation('ErrorBoundary');
  const [showDetails, setShowDetails] = useState(false);
  // NUBIX: `!isProduction && ...` dentro de la plantilla escribía "false" en el
  // título de producción ("Something went wrongfalse.").
  const title = `${t('Something went wrong')}${!isProduction ? ` ${t('in')} ${context}` : ''}.`;
  // Una promesa rechazada puede traer cualquier cosa, no sólo un Error.
  const errorMessage = error?.message ?? String(error);
  const subtitle = t('Sorry, something went wrong there. Try again.');

  const copyErrorDetails = () => {
    const errorDetails = `
Context: ${context}
Error Message: ${errorMessage}
Stack: ${error?.stack}
URL: ${window.location.href}
User Agent: ${navigator.userAgent}
${getGpuDetails()}
    `;
    navigator.clipboard.writeText(errorDetails);
    toast.success(t('Copied to clipboard'));
  };

  useEffect(() => {
    toast.error(title, {
      description: subtitle,
      action: {
        label: t('Show Details'),
        onClick: () => setShowDetails(true),
      },
      duration: 0,
    });
  }, [error]);

  // NUBIX: upstream no pintaba el diálogo en producción, así que "Show Details"
  // era un botón muerto y los reportes llegaban sin el texto del error
  // (ticket del estudio 1186425). El detalle sólo aparece si el usuario lo pide.
  return (
    <>
      <Dialog
        open={showDetails}
        onOpenChange={setShowDetails}
      >
        <DialogContent className="border-input h-[50vh] w-[90vw] border-2 sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="text-muted-foreground flex justify-between text-xl">
              <div className="flex items-center">{title}</div>
              <button
                onClick={() => {
                  copyErrorDetails();
                  setShowDetails(false);
                }}
                className="text-aqua-pale hover:text-aqua-pale/80 flex items-center gap-2 rounded bg-gray-800 px-4 py-2 font-light"
              >
                <Icons.Code className="h-4 w-4" />
                {t('Copy Details')}
              </button>
            </DialogTitle>

            <DialogDescription className="text-lg">{subtitle}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[100%]">
            <div className="space-y-4 pr-4 font-mono text-base">
              <div className="space-y-4">
                <p className="text-aqua-pale break-words text-lg">
                  {t('Context')}: {context}
                </p>
                <p className="text-aqua-pale break-words text-lg">
                  {t('Error Message')}: {errorMessage}
                </p>
                <pre className="text-aqua-pale whitespace-pre-wrap break-words rounded bg-gray-900 p-4">
                  Stack: {error?.stack}
                </pre>
                <pre className="text-aqua-pale whitespace-pre-wrap break-words rounded bg-gray-900 p-4">
                  {getGpuDetails()}
                </pre>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ErrorBoundary = ({
  context = 'OHIF',
  onReset = () => {},
  onError = () => {},
  fallbackComponent: FallbackComponent = DefaultFallback,
  children,
  fallbackRoute = null,
  isPage,
}: ErrorBoundaryProps) => {
  const [error, setError] = useState<ErrorBoundaryError | null>(null);

  const onResetHandler = () => {
    setError(null);
    onReset();
  };

  // Add error event listener to window
  useEffect(() => {
    let errorTimeout: NodeJS.Timeout;

    const handleError = (event: ErrorEvent) => {
      event.preventDefault();
      clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        setError(event.error);
        onErrorHandler(event.error, null);
      }, 100);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        setError(event.reason);
        onErrorHandler(event.reason, null);
      }, 100);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      clearTimeout(errorTimeout);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  const onErrorHandler = (error: ErrorBoundaryError, componentStack: string) => {
    console.debug(`${context} Error Boundary`, error, componentStack, context);
    onError(error, componentStack, context);
  };

  return (
    <ReactErrorBoundary
      fallbackRender={props => (
        <FallbackComponent
          error={props.error}
          context={context}
          resetErrorBoundary={props.resetErrorBoundary}
        />
      )}
      onReset={onResetHandler}
      onError={onErrorHandler}
    >
      <>
        {children}
        {error && (
          <FallbackComponent
            error={error}
            context={context}
            resetErrorBoundary={() => setError(null)}
          />
        )}
      </>
    </ReactErrorBoundary>
  );
};

export { ErrorBoundary };
