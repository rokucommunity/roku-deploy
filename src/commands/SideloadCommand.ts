import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'sideload');

        await rokuDeploy.sideload(options);
    }
}
