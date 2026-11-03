import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice();
        }
        await rokuDeploy.sideload();
    }
}
