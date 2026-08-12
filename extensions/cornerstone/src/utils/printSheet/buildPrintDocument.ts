import type { PrintHeaderInfo } from './getPrintHeader';

type BuildOptions = {
  header: PrintHeaderInfo;
  images: string[];
  columns: number;
  rows: number;
  orientation?: 'portrait' | 'landscape';
};

/**
 * Usable page height in millimetres, taking the smaller of Letter (279mm) and
 * A4 (297mm) minus the 10mm margins, plus a safety margin. Sizing against the
 * smaller sheet means the same document paginates identically on both papers,
 * so the user picks the paper in the browser dialog and nothing gets clipped.
 */
const CONTENT_HEIGHT_MM = { portrait: 248, landscape: 190 };
const HEADER_HEIGHT_MM = 20;

const escapeHtml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const joinParts = (parts: string[]) => parts.filter(Boolean).map(escapeHtml).join(' &middot; ');

export default function buildPrintDocument({
  header,
  images,
  columns,
  rows,
  orientation = 'portrait',
}: BuildOptions): string {
  const cellHeight = Math.floor((CONTENT_HEIGHT_MM[orientation] - HEADER_HEIGHT_MM) / rows);
  const imageHeight = cellHeight - 3;

  const cells = images.map(src => `<td><img src="${src}" /></td>`);

  // Pad the last row so the fixed table layout keeps every cell the same width.
  const remainder = cells.length % columns;
  if (remainder !== 0) {
    for (let i = remainder; i < columns; i++) {
      cells.push('<td></td>');
    }
  }

  const bodyRows: string[] = [];
  for (let i = 0; i < cells.length; i += columns) {
    bodyRows.push(`<tr>${cells.slice(i, i + columns).join('')}</tr>`);
  }

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

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(header.patientName)}</title>
<style>
  @page { size: ${orientation}; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: #fff; color: #000;
    font-family: Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  /* thead is the only construct Chrome and Safari reliably repeat on every printed page */
  thead { display: table-header-group; }
  thead th { padding: 0 0 2mm 0; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  td {
    height: ${cellHeight}mm;
    padding: 1.5mm;
    text-align: center;
    vertical-align: middle;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  td img { max-width: 100%; max-height: ${imageHeight}mm; display: block; margin: 0 auto; }
  .header {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 6mm; height: ${HEADER_HEIGHT_MM - 2}mm;
    border-bottom: 0.4mm solid #000; text-align: left;
  }
  .header .right { text-align: right; }
  .name { font-size: 11pt; font-weight: bold; }
  .meta { font-size: 8pt; font-weight: normal; }
</style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th colspan="${columns}">
          <div class="header">
            <div class="left">${headerLeft}</div>
            <div class="right">${headerRight}</div>
          </div>
        </th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows.join('\n      ')}
    </tbody>
  </table>
</body>
</html>`;
}
