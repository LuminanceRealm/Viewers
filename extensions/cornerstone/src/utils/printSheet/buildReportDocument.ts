import type { PrintHeaderInfo } from './getPrintHeader';

/**
 * Bloques de una hoja de informe. Se imprimen en orden, en vertical, con el
 * mismo encabezado de paciente que las hojas de imágenes.
 */
export type ReportSection =
  | { kind: 'images'; images: string[]; columns?: number; caption?: string }
  | { kind: 'table'; title?: string; columns: string[]; rows: (string | number)[][] }
  | { kind: 'keyvalues'; title?: string; items: [string, string][] }
  | { kind: 'notes'; title?: string; lines: string[]; tone?: 'plain' | 'warning' };

export interface ReportDocumentOptions {
  header: PrintHeaderInfo;
  title: string;
  /** Aviso corto bajo el título (p. ej. la leyenda beta). */
  notice?: string;
  sections: ReportSection[];
  orientation?: 'portrait' | 'landscape';
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const joinParts = (parts: string[]) => parts.filter(Boolean).map(escapeHtml).join(' &middot; ');

function renderSection(section: ReportSection): string {
  switch (section.kind) {
    case 'images': {
      const columns = Math.max(1, section.columns ?? Math.min(section.images.length, 2));
      const cells = section.images.map(src => `<div class="img"><img src="${src}" /></div>`);
      return `<section class="images" style="grid-template-columns: repeat(${columns}, 1fr)">${cells.join(
        ''
      )}</section>${section.caption ? `<p class="caption">${escapeHtml(section.caption)}</p>` : ''}`;
    }
    case 'table': {
      const head = section.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
      const body = section.rows
        .map(
          row =>
            `<tr>${row
              .map((cell, i) => `<td class="${i === 0 ? 'first' : 'num'}">${escapeHtml(cell)}</td>`)
              .join('')}</tr>`
        )
        .join('');
      return `${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ''}<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case 'keyvalues': {
      const items = section.items
        .map(
          ([k, v]) =>
            `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
        )
        .join('');
      return `${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ''}<section class="kvs">${items}</section>`;
    }
    case 'notes': {
      const lines = section.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('');
      return `${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ''}<ul class="notes ${section.tone ?? 'plain'}">${lines}</ul>`;
    }
    default:
      return '';
  }
}

/**
 * Hoja de informe de una herramienta: encabezado del paciente, título, aviso y
 * bloques (imágenes, tablas, pares clave-valor, notas). El usuario la imprime o
 * la guarda como PDF desde el diálogo del navegador.
 */
export default function buildReportDocument({
  header,
  title,
  notice,
  sections,
  orientation = 'portrait',
}: ReportDocumentOptions): string {
  const headerLeft = [
    `<div class="name">${escapeHtml(header.patientName) || '&nbsp;'}</div>`,
    `<div class="meta">${joinParts([
      header.patientId ? `ID: ${header.patientId}` : '',
      header.studyDate,
      header.modality,
    ])}</div>`,
  ].join('');
  const headerRight = [
    `<div class="meta">${escapeHtml(header.institution)}</div>`,
    `<div class="meta">${joinParts([header.studyDescription, header.seriesDescription])}</div>`,
  ].join('');

  const generated = new Date().toLocaleString('es-MX');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} · ${escapeHtml(header.patientName)}</title>
<style>
  @page { size: ${orientation}; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: #fff; color: #000;
    font-family: Helvetica, Arial, sans-serif; font-size: 10pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .header {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 6mm;
    border-bottom: 0.4mm solid #000; padding-bottom: 2mm; margin-bottom: 4mm;
  }
  .header .right { text-align: right; }
  .name { font-size: 11pt; font-weight: bold; }
  .meta { font-size: 8pt; }
  h1 { font-size: 14pt; margin: 0 0 1mm 0; }
  h2 { font-size: 10pt; margin: 5mm 0 1.5mm 0; text-transform: uppercase; letter-spacing: 0.04em; color: #333; }
  .notice { font-size: 8.5pt; color: #7a4b00; background: #fff6e0; border-left: 1mm solid #d98d00; padding: 1.5mm 2.5mm; margin: 0 0 4mm 0; }
  section.images { display: grid; gap: 3mm; margin: 2mm 0; break-inside: avoid; }
  .img { background: #000; display: flex; align-items: center; justify-content: center; }
  .img img { max-width: 100%; max-height: 150mm; display: block; }
  .caption { font-size: 8pt; color: #444; margin: 1mm 0 0 0; }
  table.data { width: 100%; border-collapse: collapse; font-size: 9pt; break-inside: avoid; }
  table.data th, table.data td { border-bottom: 0.2mm solid #bbb; padding: 1.2mm 2mm; text-align: right; }
  table.data th:first-child, table.data td.first { text-align: left; }
  table.data thead th { border-bottom: 0.4mm solid #000; font-weight: bold; }
  section.kvs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5mm 6mm; break-inside: avoid; }
  .kv .k { display: block; font-size: 8pt; color: #555; }
  .kv .v { display: block; font-size: 10pt; }
  ul.notes { margin: 1mm 0; padding-left: 5mm; font-size: 9pt; }
  ul.notes.warning { color: #7a4b00; }
  .footer { margin-top: 6mm; font-size: 7.5pt; color: #666; border-top: 0.2mm solid #bbb; padding-top: 1.5mm; }
</style>
</head>
<body>
  <div class="header">
    <div class="left">${headerLeft}</div>
    <div class="right">${headerRight}</div>
  </div>
  <h1>${escapeHtml(title)}</h1>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}
  ${sections.map(renderSection).join('\n  ')}
  <p class="footer">Generado con el visor NUBIX el ${escapeHtml(generated)}.</p>
</body>
</html>`;
}
