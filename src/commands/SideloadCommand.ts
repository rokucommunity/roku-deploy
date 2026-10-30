import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        let options = loadCommandOptions(args);

        await rokuDeploy.sideload(options);
    }
}
