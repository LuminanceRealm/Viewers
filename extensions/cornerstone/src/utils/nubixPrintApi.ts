/**
 * Cliente del API de NUBIX para impresión DICOM.
 *
 * Sigue el mismo camino que `toggleFeaturedImage` en commandsModule: el visor
 * corre cross-origin y sin cookies, así que el origen del API sale del
 * manifest y la credencial es el header Authorization de la sesión.
 */

export interface NubixPrinter {
  id: number;
  name: string;
  description?: string;
  default_layout: string;
  film_size_id: string;
  medium_type: string;
  film_orientation: string;
  magnification_type?: string;
  color: boolean;
}

export interface PrintJobRequest {
  printer_id: number;
  layout: string;
  copies: number;
  film_size_id?: string;
  medium_type?: string;
  film_orientation?: string;
  pages: Array<{ width: number; height: number; content_type: string }>;
}

export interface PrintJobStatus {
  uuid: string;
  status: 'draft' | 'pending' | 'claimed' | 'printing' | 'done' | 'failed';
  error?: string;
  printer_status_info?: string;
  finishedAt?: string;
}

interface CreatedJob {
  id: number;
  uuid: string;
  status: string;
  uploads: Array<{ index: number; url: string }>;
}

interface NubixStore {
  manifestUrl?: string;
  studyIdByUID?: Record<string, number>;
}

function store(): NubixStore | undefined {
  // El store lo publica DicomJSONDataSource al cargar el manifest
  return (window as unknown as { nubixFeatured?: NubixStore }).nubixFeatured;
}

export function apiOrigin(): string | null {
  const manifestUrl = store()?.manifestUrl;
  if (!manifestUrl) {
    return null;
  }

  try {
    return new URL(manifestUrl).origin;
  } catch {
    return null;
  }
}

export function studyIdFor(studyInstanceUID: string): number | null {
  return store()?.studyIdByUID?.[studyInstanceUID] ?? null;
}

async function request<T>(
  url: string,
  authHeader: Record<string, string>,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeader,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `El servidor respondió ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listPrinters(
  studyId: number,
  authHeader: Record<string, string>
): Promise<NubixPrinter[]> {
  const origin = apiOrigin();
  if (!origin) {
    return [];
  }

  return request<NubixPrinter[]>(
    `${origin}/api/v1/organization/study/${studyId}/printers`,
    authHeader
  );
}

/**
 * Crea el trabajo, sube cada página directo a S3 con la URL presignada y
 * recién entonces lo confirma.
 *
 * El confirmar aparte no es ceremonia: sin él, el agente puede reclamar un
 * trabajo cuyas imágenes todavía no están en S3, y un 404 al descargarlas se
 * le presenta al usuario como "falló la impresora".
 */
export async function submitPrintJob(
  studyId: number,
  authHeader: Record<string, string>,
  job: PrintJobRequest,
  pages: Blob[]
): Promise<{ id: number; uuid: string }> {
  const origin = apiOrigin();
  if (!origin) {
    throw new Error('No se pudo determinar el servidor de NUBIX');
  }

  const base = `${origin}/api/v1/organization/study/${studyId}/print-job`;

  const created = await request<CreatedJob>(base, authHeader, {
    method: 'POST',
    body: JSON.stringify(job),
  });

  await Promise.all(
    created.uploads.map(async upload => {
      const blob = pages[upload.index];
      const response = await fetch(upload.url, {
        method: 'PUT',
        headers: { 'Content-Type': job.pages[upload.index].content_type },
        body: blob,
      });

      if (!response.ok) {
        throw new Error(`No se pudo subir la página ${upload.index + 1}`);
      }
    })
  );

  await request(`${base}/${created.id}`, authHeader, {
    method: 'PATCH',
    body: JSON.stringify({ committed: true }),
  });

  return { id: created.id, uuid: created.uuid };
}

export async function getPrintJobStatus(
  studyId: number,
  jobId: number,
  authHeader: Record<string, string>
): Promise<PrintJobStatus> {
  const origin = apiOrigin();
  if (!origin) {
    throw new Error('No se pudo determinar el servidor de NUBIX');
  }

  return request<PrintJobStatus>(
    `${origin}/api/v1/organization/study/${studyId}/print-job/${jobId}`,
    authHeader
  );
}
