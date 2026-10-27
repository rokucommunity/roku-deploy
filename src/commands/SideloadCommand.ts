import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        const options = loadCommandOptions(args);
        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice(options);
        }
        await rokuDeploy.sideload(options);
    }
}
