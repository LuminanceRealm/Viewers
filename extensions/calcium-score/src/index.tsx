import { addTool } from '@cornerstonejs/tools';

import { id } from './id';
import commandsModule from './commandsModule';
import getPanelModule from './getPanelModule';
import CalciumLesionPickTool from './tools/CalciumLesionPickTool';
import { TOOL_NAME } from './constants';

/**
 * NUBIX: score de calcio coronario (Agatston) semiautomático.
 *
 * La extensión aporta una herramienta de clic, un panel lateral y los comandos
 * que preparan la serie y calculan el score. El modo debe añadir la herramienta
 * (`toolNames.CalciumScore`) como pasiva en su toolGroup y el panel a su layout.
 */
const calciumScoreExtension = {
  id,
  preRegistration() {
    addTool(CalciumLesionPickTool);
  },
  getPanelModule,
  getCommandsModule({ servicesManager, commandsManager }) {
    return commandsModule({ servicesManager, commandsManager });
  },
};

export const toolNames = { CalciumScore: TOOL_NAME };

export default calciumScoreExtension;
