export { default as getPrintHeader } from './getPrintHeader';
export { default as captureVisibleViewports } from './captureVisibleViewports';
export { default as captureDisplaySetImages } from './captureDisplaySetImages';
export { default as buildPrintDocument } from './buildPrintDocument';
export { default as openPrintSheet } from './openPrintSheet';
export { default as PrintConfirmDialog } from './PrintConfirmDialog';

/** Sheets beyond this count require an explicit confirmation from the user. */
export const MAX_PAGES_WITHOUT_CONFIRM = 10;

/**
 * Fixed grid rules for printing a whole series — no user configuration.
 * A single image gets the whole sheet, a handful go 2x2, and anything larger
 * (CT/MR) falls into the classic 4x5 film grid and paginates on its own.
 */
export function getSeriesGrid(imageCount: number): { columns: number; rows: number } {
  if (imageCount <= 1) {
    return { columns: 1, rows: 1 };
  }
  if (imageCount <= 4) {
    return { columns: 2, rows: 2 };
  }
  return { columns: 4, rows: 5 };
}
