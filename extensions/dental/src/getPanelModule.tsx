import React from 'react';
import PanelDental from './panels/PanelDental';

function getPanelModule() {
  return [
    {
      name: 'dental',
      iconName: 'tool-dental',
      iconLabel: 'Dental',
      label: 'Dental',
      component: () => <PanelDental />,
    },
  ];
}

export default getPanelModule;
