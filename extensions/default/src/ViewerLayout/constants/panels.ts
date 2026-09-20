const expandedInsideBorderSize = 0;
const collapsedInsideBorderSize = 4;
const collapsedOutsideBorderSize = 4;
const collapsedWidth = 25;

// En teléfono el modo longitudinal voltea la disposición y pone el navegador de
// series en el riel derecho. A 280 px la rejilla de miniaturas (135 px cada una)
// acomoda dos columnas y el panel abierto se come tres cuartas partes de la
// pantalla; a 160 px cabe una columna y la imagen conserva más de la mitad, que
// es también lo que hace cómodo el toque sobre la imagen para cerrarlo.
const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

const rightPanelInitialExpandedWidth = isMobile ? 160 : 280;
const leftPanelInitialExpandedWidth = 282;

const panelGroupDefinition = {
  groupId: 'viewerLayoutResizablePanelGroup',
  shared: {
    expandedInsideBorderSize,
    collapsedInsideBorderSize,
    collapsedOutsideBorderSize,
    collapsedWidth,
  },
  left: {
    // id
    panelId: 'viewerLayoutResizableLeftPanel',
    // expanded width
    initialExpandedWidth: leftPanelInitialExpandedWidth,
    // expanded width + expanded inside border
    minimumExpandedOffsetWidth: 145 + expandedInsideBorderSize,
    // initial expanded width
    initialExpandedOffsetWidth: leftPanelInitialExpandedWidth + expandedInsideBorderSize,
    // collapsed width + collapsed inside border + collapsed outside border
    collapsedOffsetWidth: collapsedWidth + collapsedInsideBorderSize + collapsedOutsideBorderSize,
  },
  right: {
    panelId: 'viewerLayoutResizableRightPanel',
    initialExpandedWidth: rightPanelInitialExpandedWidth,
    minimumExpandedOffsetWidth: rightPanelInitialExpandedWidth + expandedInsideBorderSize,
    initialExpandedOffsetWidth: rightPanelInitialExpandedWidth + expandedInsideBorderSize,
    collapsedOffsetWidth: collapsedWidth + collapsedInsideBorderSize + collapsedOutsideBorderSize,
  },
};

export { panelGroupDefinition };
