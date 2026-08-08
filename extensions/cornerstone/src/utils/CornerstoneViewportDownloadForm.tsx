import React, { useEffect, useState } from 'react';
import { getEnabledElement } from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';
import { getEnabledElement as OHIFgetEnabledElement } from '../state';
import { useSystem } from '@ohif/core/src';
import {
  disableOffscreenViewport,
  enableOffscreenViewport,
  loadActiveImage,
  rasterizeViewport,
  syncAnnotations,
} from './viewportRasterizer';

const DEFAULT_SIZE = 512;
const VIEWPORT_ID = 'cornerstone-viewport-download-form';

const FILE_TYPE_OPTIONS = [
  {
    value: 'jpg',
    label: 'JPG',
  },
  {
    value: 'png',
    label: 'PNG',
  },
];

type ViewportDownloadFormProps = {
  hide: () => void;
  activeViewportId: string;
};

const CornerstoneViewportDownloadForm = ({
  hide,
  activeViewportId: activeViewportIdProp,
}: ViewportDownloadFormProps) => {
  const { servicesManager } = useSystem();
  const { customizationService, cornerstoneViewportService } = servicesManager.services;
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [viewportDimensions, setViewportDimensions] = useState({
    width: DEFAULT_SIZE,
    height: DEFAULT_SIZE,
  });

  const warningState = customizationService.getCustomization('viewportDownload.warningMessage') as {
    enabled: boolean;
    value: string;
  };

  const refViewportEnabledElementOHIF = OHIFgetEnabledElement(activeViewportIdProp);
  const activeViewportElement = refViewportEnabledElementOHIF?.element;
  const { viewportId: activeViewportId, renderingEngineId } =
    getEnabledElement(activeViewportElement);

  const renderingEngine = cornerstoneViewportService.getRenderingEngine();
  const toolGroup = ToolGroupManager.getToolGroupForViewport(activeViewportId, renderingEngineId);

  useEffect(() => {
    const toolModeAndBindings = Object.keys(toolGroup.toolOptions).reduce((acc, toolName) => {
      const tool = toolGroup.toolOptions[toolName];
      const { mode, bindings } = tool;

      return {
        ...acc,
        [toolName]: { mode, bindings },
      };
    }, {});

    return () => {
      Object.keys(toolModeAndBindings).forEach(toolName => {
        const { mode, bindings } = toolModeAndBindings[toolName];
        toolGroup.setToolMode(toolName, mode, { bindings });
      });
    };
  }, []);

  const handleEnableViewport = (viewportElement: HTMLElement) => {
    enableOffscreenViewport(renderingEngine, activeViewportElement, VIEWPORT_ID, viewportElement);
  };

  const handleDisableViewport = async () => {
    disableOffscreenViewport(renderingEngine, VIEWPORT_ID);
  };

  const handleLoadImage = async (width: number, height: number) =>
    loadActiveImage(
      renderingEngine,
      activeViewportElement,
      VIEWPORT_ID,
      width,
      height,
      DEFAULT_SIZE
    );

  const handleToggleAnnotations = (show: boolean) => {
    syncAnnotations(renderingEngine, activeViewportElement, VIEWPORT_ID, show);
  };

  useEffect(() => {
    if (viewportDimensions.width && viewportDimensions.height) {
      setTimeout(() => {
        handleLoadImage(viewportDimensions.width, viewportDimensions.height);
        handleToggleAnnotations(showAnnotations);
      }, 100);
    }
  }, [viewportDimensions, showAnnotations]);

  const handleDownload = async (filename: string, fileType: string) => {
    const canvas = await rasterizeViewport(VIEWPORT_ID);

    if (!canvas) {
      return;
    }

    const link = document.createElement('a');
    link.download = `${filename}.${fileType}`;
    link.href = canvas.toDataURL(`image/${fileType}`, 1.0);
    link.click();
  };

  const ViewportDownloadFormNew = customizationService.getCustomization(
    'ohif.captureViewportModal'
  );

  return (
    <ViewportDownloadFormNew
      onClose={hide}
      defaultSize={DEFAULT_SIZE}
      fileTypeOptions={FILE_TYPE_OPTIONS}
      viewportId={VIEWPORT_ID}
      showAnnotations={showAnnotations}
      onAnnotationsChange={setShowAnnotations}
      dimensions={viewportDimensions}
      onDimensionsChange={setViewportDimensions}
      onEnableViewport={handleEnableViewport}
      onDisableViewport={handleDisableViewport}
      onDownload={handleDownload}
      warningState={warningState}
    />
  );
};

export default CornerstoneViewportDownloadForm;
