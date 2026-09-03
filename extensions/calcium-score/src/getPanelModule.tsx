import React from 'react';
import PanelCalciumScore from './panels/PanelCalciumScore';

function getPanelModule() {
  return [
    {
      name: 'calciumScore',
      iconName: 'tool-calcium-score',
      iconLabel: 'Score de calcio',
      label: 'Score de calcio',
      component: () => <PanelCalciumScore />,
    },
  ];
}

export default getPanelModule;
