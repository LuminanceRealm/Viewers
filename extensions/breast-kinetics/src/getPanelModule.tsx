import React from 'react';
import PanelBreastKinetics from './panels/PanelBreastKinetics';

function getPanelModule() {
  return [
    {
      name: 'breastKinetics',
      iconName: 'tool-breast-kinetics',
      iconLabel: 'Curvas cinéticas',
      label: 'Curvas cinéticas',
      component: () => <PanelBreastKinetics />,
    },
  ];
}

export default getPanelModule;
