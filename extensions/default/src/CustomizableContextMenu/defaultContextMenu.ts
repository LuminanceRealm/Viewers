const defaultContextMenu = {
  id: 'measurementsContextMenu',
  customizationType: 'ohif.contextMenu',
  menus: [
    // Get the items from the UI Customization for the menu name (and have a custom name)
    {
      id: 'forExistingMeasurement',
      selector: ({ nearbyToolData }) => !!nearbyToolData,
      items: [
        {
          label: 'Borrar medida',
          commands: [
            {
              commandName: 'deleteMeasurement',
              // we only have support for cornerstoneTools context menu since
              // they are svg based
              context: 'CORNERSTONE',
            },
          ],
        },
        {
          label: 'Agregar etiqueta',
          commands: [
            {
              commandName: 'setMeasurementLabel',
            },
          ],
        },
      ],
    },
  ],
};

export default defaultContextMenu;
