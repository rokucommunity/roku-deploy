import { rokuDeploy } from '../index';
import { loadFlowOptions } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        const options = loadFlowOptions(args);
        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice(options);
        }
        await rokuDeploy.sideload(options);
    }
}
