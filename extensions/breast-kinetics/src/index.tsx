import { addTool } from '@cornerstonejs/tools';

import { id } from './id';
import commandsModule from './commandsModule';
import getPanelModule from './getPanelModule';
import { TOOL_NAME } from './constants';
import BreastRoiTool from './tools/BreastRoiTool';

/**
 * NUBIX: curvas cinéticas (tiempo-intensidad) de resonancia dinámica de mama.
 *
 * Panel lateral con fases emparejadas por geometría, ROIs circulares sobre la
 * lesión, curva de realce y clasificación BI-RADS. El modo añade la herramienta
 * (`toolNames.BreastKinetics`) a su toolGroup y el panel a su layout.
 */
const breastKineticsExtension = {
  id,
  preRegistration() {
    addTool(BreastRoiTool);
  },
  getPanelModule,
  getCommandsModule({ servicesManager, commandsManager }) {
    return commandsModule({ servicesManager, commandsManager });
  },
};

export const toolNames = { BreastKinetics: TOOL_NAME };

export default breastKineticsExtension;
