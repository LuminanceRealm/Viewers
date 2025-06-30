import type { Button } from '@ohif/core/types';

import { EVENTS } from '@cornerstonejs/core';
import { ViewportGridService } from '@ohif/core';

const ReferenceLinesListeners = [
  {
    commandName: 'setSourceViewportForReferenceLinesTool',
    context: 'CORNERSTONE',
  },
];

export const setToolActiveToolbar = {
  commandName: 'setToolActiveToolbar',
  commandOptions: {
    toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
  },
};

const toolbarButtons: Button[] = [
  // sections
  {
    id: 'MeasurementTools',
    uiType: 'ohif.toolButtonList',
    props: {
      buttonSection: 'measurementSection',
      groupId: 'MeasurementTools',
    },
  },
  {
    id: 'MoreTools',
    uiType: 'ohif.toolButtonList',
    props: {
      buttonSection: 'moreToolsSection',
      groupId: 'MoreTools',
    },
  },
  // tool defs
  {
    id: 'Reset',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-reset',
      label: 'Restaurar',
      tooltip: 'Restaurar',
      commands: 'resetViewport',
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'rotate-right',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rotate-right',
      label: 'Rotar',
      tooltip: 'Rotate +90',
      commands: 'rotateViewportCW',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'flipHorizontal',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-flip-horizontal',
      label: 'Voltear horizontalmente',
      tooltip: 'Flip Horizontally',
      commands: 'flipViewportHorizontal',
      evaluate: [
        'evaluate.viewportProperties.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ImageSliceSync',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'link',
      label: 'Sincronización',
      tooltip: 'Enable position synchronization on stack viewports',
      commands: {
        commandName: 'toggleSynchronizer',
        commandOptions: {
          type: 'imageSlice',
        },
      },
      listeners: {
        [EVENTS.VIEWPORT_NEW_IMAGE_SET]: {
          commandName: 'toggleImageSliceSync',
          commandOptions: { toggledState: true },
        },
      },
      evaluate: [
        'evaluate.cornerstone.synchronizer',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ReferenceLines',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-referenceLines',
      label: 'Líneas de referencia',
      tooltip: 'Show Reference Lines',
      commands: 'toggleEnabledDisabledToolbar',
      listeners: {
        [ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED]: ReferenceLinesListeners,
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: ReferenceLinesListeners,
      },
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'ImageOverlayViewer',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'toggle-dicom-overlay',
      label: 'Superposición',
      tooltip: 'Toggle Image Overlay',
      commands: 'toggleEnabledDisabledToolbar',
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'StackScroll',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-stack-scroll',
      label: 'Recorrer',
      tooltip: 'Recorrer',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'invert',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-invert',
      label: 'Negativo',
      tooltip: 'Invert Colors',
      commands: 'invertViewport',
      evaluate: [
        'evaluate.viewportProperties.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'Probe',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-probe',
      label: 'Probar',
      tooltip: 'Probe',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Cine',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-cine',
      label: 'Cine',
      tooltip: 'Cine',
      commands: 'toggleCine',
      evaluate: [
        'evaluate.cine',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['volume3d'],
        },
      ],
    },
  },
  {
    id: 'Angle',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-angle',
      label: 'Ángulo',
      tooltip: 'Angle',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'CobbAngle',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-cobb-angle',
      label: 'Ángulo de Cobb',
      tooltip: 'Cobb Angle',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Magnify',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-magnify',
      label: 'Zoom-in',
      tooltip: 'Zoom-in',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'CalibrationLine',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-calibration',
      label: 'Calibración',
      tooltip: 'Calibration Line',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'TagBrowser',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'dicom-tag-browser',
      label: 'Navegador de etiquetas DICOM',
      tooltip: 'Dicom Tag Browser',
      commands: 'openDICOMTagViewer',
    },
  },
  {
    id: 'AdvancedMagnify',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-loupe',
      label: 'Lupa de magnificación',
      tooltip: 'Magnify Probe',
      commands: 'toggleActiveDisabledToolbar',
      evaluate: [
        'evaluate.cornerstoneTool.toggle.ifStrictlyDisabled',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'UltrasoundDirectionalTool',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-ultrasound-bidirectional',
      label: 'Ultrasonido direccional',
      tooltip: 'Ultrasound Directional',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.modality.supported',
          supportedModalities: ['US'],
        },
      ],
    },
  },
  {
    id: 'WindowLevelRegion',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-window-region',
      label: 'Ventana / Nivel de región',
      tooltip: 'Window Level Region',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'Length',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-length',
      label: 'Longitud',
      tooltip: 'Longitud',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Bidirectional',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-bidirectional',
      label: 'Bidireccional',
      tooltip: 'Bidirectional Tool',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'ArrowAnnotate',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-annotate',
      label: 'Anotación',
      tooltip: 'Arrow Annotate',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'EllipticalROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-ellipse',
      label: 'Elipse',
      tooltip: 'Ellipse ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'RectangleROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rectangle',
      label: 'Rectángulo',
      tooltip: 'Rectangle ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'CircleROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-circle',
      label: 'Círculo',
      tooltip: 'Circle Tool',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'PlanarFreehandROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-freehand-roi',
      label: 'Freehand ROI',
      tooltip: 'Freehand ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'SplineROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-spline-roi',
      label: 'ROI de spline',
      tooltip: 'Spline ROI',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'LivewireContour',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-livewire',
      label: 'Herramienta de livewire',
      tooltip: 'Livewire tool',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  // Window Level
  {
    id: 'WindowLevel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-window-level',
      label: 'Ventana / Nivel',
      commands: setToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['wholeSlide'],
        },
      ],
    },
  },
  {
    id: 'Pan',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-move',
      label: 'Mover',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Zoom',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-zoom',
      label: 'Zoom',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'TrackballRotate',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-3d-rotate',
      label: 'Rotar 3D',
      commands: setToolActiveToolbar,
      evaluate: {
        name: 'evaluate.cornerstoneTool',
        disabledText: 'Select a 3D viewport to enable this tool',
      },
    },
  },
  {
    id: 'Capture',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: 'Descargar imagen',
      commands: 'showDownloadViewportModal',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'wholeSlide'],
        },
      ],
    },
  },
  {
    id: 'Layout',
    uiType: 'ohif.layoutSelector',
    props: {
      rows: 3,
      columns: 4,
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'Crosshairs',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-crosshair',
      label: 'Punto de mira',
      commands: {
        commandName: 'setToolActiveToolbar',
        commandOptions: {
          toolGroupIds: ['mpr'],
        },
      },
      evaluate: {
        name: 'evaluate.cornerstoneTool',
        disabledText: 'Select an MPR viewport to enable this tool',
      },
    },
  },
  {
    id: 'ShowViewportOverlay',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'EyeVisible',
      label: 'Ocultar/Mostar datos',
      tooltip: 'Ocultar/Mostar datos',
      commands: 'toggleViewportOverlay',
    },
  },
  // {
  //   id: 'Undo',
  //   uiType: 'ohif.toolButton',
  //   props: {
  //     type: 'tool',
  //     icon: 'prev-arrow',
  //     label: 'Undo',
  //     commands: {
  //       commandName: 'undo',
  //     },
  //     evaluate: 'evaluate.action',
  //   },
  // },
  // {
  //   id: 'Redo',
  //   uiType: 'ohif.toolButton',
  //   props: {
  //     type: 'tool',
  //     icon: 'next-arrow',
  //     label: 'Redo',
  //     commands: {
  //       commandName: 'redo',
  //     },
  //     evaluate: 'evaluate.action',
  //   },
  // },
];

export default toolbarButtons;
