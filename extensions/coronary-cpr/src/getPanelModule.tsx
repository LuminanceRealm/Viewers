import React from 'react';
import PanelCoronaryCpr from './panels/PanelCoronaryCpr';

function getPanelModule() {
  return [
    {
      name: 'coronaryCpr',
      iconName: 'tool-coronary-cpr',
      iconLabel: 'CPR coronario',
      label: 'CPR coronario',
      component: () => <PanelCoronaryCpr />,
    },
  ];
}

export default getPanelModule;
