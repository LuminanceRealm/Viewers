import { addTool } from '@cornerstonejs/tools';

import { id } from './id';
import commandsModule from './commandsModule';
import getPanelModule from './getPanelModule';
import { TOOL_NAME } from './constants';
import DentalArchTool, { renderArch } from './tools/DentalArchTool';
import DentalDock from './components/DentalDock';
import { useDentalStore } from './store/useDentalStore';
import { disposeAllVolumeGrids } from './utils/volumeGrid';

/**
 * NUBIX: herramientas dentales sobre CBCT.
 *
 * Aporta el panel de controles, la franja inferior con la panorámica y los
 * cortes transversales (customization `viewerLayout.bottomDock`, que pinta
 * ViewerLayout bajo la rejilla de viewports), la herramienta para trazar el
 * arco y los comandos. El modo añade la herramienta (`toolNames.DentalArch`) a
 * sus toolGroups y el panel a su layout.
 */
const dentalExtension = {
  id,
  preRegistration() {
    addTool(DentalArchTool);
    // El arco, las líneas de corte y el canal se dibujan sobre los viewports a
    // partir del store: cualquier cambio los redibuja.
    useDentalStore.subscribe(() => renderArch());
  },
  // La rejilla guarda los píxeles de toda la serie: al salir del estudio se suelta.
  onModeExit() {
    useDentalStore.getState().reset();
    disposeAllVolumeGrids();
  },
  getPanelModule,
  getCommandsModule({ servicesManager, commandsManager }) {
    return commandsModule({ servicesManager, commandsManager });
  },
  getCustomizationModule() {
    return [{ name: 'default', value: { 'viewerLayout.bottomDock': DentalDock } }];
  },
};

export const toolNames = { DentalArch: TOOL_NAME };

export default dentalExtension;
