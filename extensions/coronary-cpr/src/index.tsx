import { id } from './id';
import commandsModule from './commandsModule';
import getPanelModule from './getPanelModule';
import { TOOL_NAME } from './constants';
import CoronaryCenterlineTool from './tools/CoronaryCenterlineTool';
import { addTool } from '@cornerstonejs/tools';

/**
 * NUBIX: reformateo curvo (CPR) de coronarias.
 *
 * Aporta un panel lateral con la tira CPR, la herramienta de trazado de la
 * centerline y los comandos que preparan la serie. El modo añade la herramienta
 * (`toolNames.CoronaryCPR`) a sus toolGroups y el panel a su layout.
 */
const coronaryCprExtension = {
  id,
  preRegistration() {
    addTool(CoronaryCenterlineTool);
  },
  getPanelModule,
  getCommandsModule({ servicesManager, commandsManager }) {
    return commandsModule({ servicesManager, commandsManager });
  },
};

export const toolNames = { CoronaryCPR: TOOL_NAME };

export default coronaryCprExtension;
