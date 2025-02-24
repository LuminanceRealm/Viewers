import type { RunCommand } from '@ohif/core/types';
import { EVENTS } from '@cornerstonejs/core';
import { ToolbarService, ViewportGridService } from '@ohif/core';
import { setToolActiveToolbar } from './toolbarButtons';
const { createButton } = ToolbarService;

const ReferenceLinesListeners: RunCommand = [
  {
    commandName: 'setSourceViewportForReferenceLinesTool',
    context: 'CORNERSTONE',
  },
];

const moreTools = [
  {
    id: 'MoreTools',
    uiType: 'ohif.toolButtonList',
    props: {
      groupId: 'MoreTools',
      evaluate: 'evaluate.group.promoteToPrimaryIfCornerstoneToolNotActiveInTheList',
      primary: createButton({
        id: 'Reset',
        icon: 'tool-reset',
        tooltip: 'Reset View',
        label: 'Reset',
        commands: 'resetViewport',
        evaluate: 'evaluate.action',
      }),
      secondary: {
        icon: 'chevron-down',
        label: '',
        tooltip: 'More Tools',
      },
      items: [
        createButton({
          id: 'Reset',
          icon: 'tool-reset',
          label: 'Restaurar',
          tooltip: 'Reset View',
          commands: 'resetViewport',
          evaluate: 'evaluate.action',
        }),
        createButton({
          id: 'rotate-right',
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
        }),
        createButton({
          id: 'flipHorizontal',
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
        }),
        createButton({
          id: 'ImageSliceSync',
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
        }),
        createButton({
          id: 'ReferenceLines',
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
        }),
        createButton({
          id: 'ImageOverlayViewer',
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
        }),
        createButton({
          id: 'StackScroll',
          icon: 'tool-stack-scroll',
          label: 'Recorrer',
          tooltip: 'Stack Scroll',
          commands: setToolActiveToolbar,
          evaluate: 'evaluate.cornerstoneTool',
        }),
        createButton({
          id: 'invert',
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
        }),
        createButton({
          id: 'Probe',
          icon: 'tool-probe',
          label: 'Probar',
          tooltip: 'Probe',
          commands: setToolActiveToolbar,
          evaluate: 'evaluate.cornerstoneTool',
        }),
        createButton({
          id: 'Cine',
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
        }),
        // Remove these three buttons
        /*
        createButton({
          id: 'Angle',
          icon: 'tool-angle',
          label: 'Angle',
          tooltip: 'Angle',
          commands: setToolActiveToolbar,
          evaluate: 'evaluate.cornerstoneTool',
        }),
        createButton({
          id: 'CobbAngle',
          icon: 'icon-tool-cobb-angle',
          label: 'Cobb Angle',
          tooltip: 'Cobb Angle',
          commands: setToolActiveToolbar,
          evaluate: 'evaluate.cornerstoneTool',
        }),
        createButton({
          id: 'CalibrationLine',
          icon: 'tool-calibration',
          label: 'Calibration',
          tooltip: 'Calibration Line',
          commands: setToolActiveToolbar,
          evaluate: 'evaluate.cornerstoneTool',
        }),
        */
        createButton({
          id: 'Magnify',
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
        }),
        createButton({
          id: 'TrackballRotate',
          icon: 'tool-3d-rotate',
          label: 'Rotar 3D',
          tooltip: '3D Rotate',
          commands: setToolActiveToolbar,
          evaluate: {
            name: 'evaluate.cornerstoneTool',
            disabledText: 'Select a 3D viewport to enable this tool',
          },
        }),
        createButton({
          id: 'Crosshairs',
          icon: 'tool-crosshair',
          label: 'Punto de mira',
          tooltip: 'Crosshairs',
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
        }),
        createButton({
          id: 'TagBrowser',
          icon: 'dicom-tag-browser',
          label: 'Navegador de etiquetas DICOM',
          tooltip: 'Dicom Tag Browser',
          commands: 'openDICOMTagViewer',
        }),
        createButton({
          id: 'AdvancedMagnify',
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
        }),
        createButton({
          id: 'UltrasoundDirectionalTool',
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
        }),
        createButton({
          id: 'WindowLevelRegion',
          icon: 'icon-tool-window-region',
          label: 'Venta / Nivel de región',
          tooltip: 'Window Level Region',
          commands: setToolActiveToolbar,
          evaluate: [
            'evaluate.cornerstoneTool',
            {
              name: 'evaluate.viewport.supported',
              unsupportedViewportTypes: ['video'],
            },
          ],
        }),
      ],
    },
  },
];

export default moreTools;
