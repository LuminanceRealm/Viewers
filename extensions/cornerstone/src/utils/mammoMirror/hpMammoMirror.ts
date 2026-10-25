/**
 * NUBIX: protocolo de lectura en espejo para mamografía 2D. Sólo entra si el
 * estudio tiene al menos dos de las cuatro proyecciones estándar en series de
 * una sola imagen (`classifyMammoDisplaySet`); la tomosíntesis nunca cuenta y,
 * si es lo único que hay, el estudio se abre con el protocolo de siempre.
 */
export const MAMMO_MIRROR_PROTOCOL_ID = '@nubix/mammoMirror';
export const MAMMO_VIEW_ATTRIBUTE = 'nubixMammoView';
export const MAMMO_VIEW_COUNT_ATTRIBUTE = 'nubixMammoViewCount';
export const MAMMO_MIRROR_SYNC_TYPE = 'nubixmammomirror';

const CC_SYNC_GROUP = {
  type: MAMMO_MIRROR_SYNC_TYPE,
  id: 'nubixMammoMirrorCC',
  source: true,
  target: true,
};

const MLO_SYNC_GROUP = {
  ...CC_SYNC_GROUP,
  id: 'nubixMammoMirrorMLO',
};

const viewSelector = code => ({
  seriesMatchingRules: [
    {
      attribute: MAMMO_VIEW_ATTRIBUTE,
      constraint: { equals: { value: code } },
      required: true,
    },
  ],
});

const viewport = (code, syncGroup) => ({
  viewportOptions: {
    viewportType: 'stack',
    toolGroupId: 'default',
    allowUnmatchedView: true,
    syncGroups: [syncGroup],
  },
  displaySets: [{ id: code }],
});

const row = (codes, syncGroup) => codes.map(code => viewport(code, syncGroup));

const pair = (id, name, codes, syncGroup) => ({
  id,
  name,
  viewportStructure: {
    layoutType: 'grid',
    properties: { rows: 1, columns: 2 },
  },
  viewports: row(codes, syncGroup),
});

export const hpMammoMirror = {
  id: MAMMO_MIRROR_PROTOCOL_ID,
  locked: true,
  name: 'Mamografía en espejo',
  createdDate: '2026-10-25',
  modifiedDate: '2026-10-25',
  availableTo: {},
  editableBy: {},
  // Sólo el estudio activo: el previo no viene en el mismo manifiesto.
  numberOfPriorsReferenced: -1,
  protocolMatchingRules: [
    {
      id: 'mammo2DViews',
      weight: 200,
      attribute: MAMMO_VIEW_COUNT_ATTRIBUTE,
      constraint: { greaterThan: { value: 1 } },
      required: true,
    },
  ],
  toolGroupIds: ['default'],
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
    },
    displaySets: [{ id: 'RCC', matchedDisplaySetsIndex: -1 }],
  },
  displaySetSelectors: {
    RCC: viewSelector('RCC'),
    LCC: viewSelector('LCC'),
    RMLO: viewSelector('RMLO'),
    LMLO: viewSelector('LMLO'),
  },
  stages: [
    {
      id: 'mammoFourUp',
      name: '4 proyecciones',
      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 2, columns: 2 },
      },
      viewports: [...row(['RCC', 'LCC'], CC_SYNC_GROUP), ...row(['RMLO', 'LMLO'], MLO_SYNC_GROUP)],
    },
    pair('mammoCC', 'CC', ['RCC', 'LCC'], CC_SYNC_GROUP),
    pair('mammoMLO', 'MLO', ['RMLO', 'LMLO'], MLO_SYNC_GROUP),
  ],
};
