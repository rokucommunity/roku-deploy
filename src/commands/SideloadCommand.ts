import type { RekeyDeviceOptions, SideloadOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        const rokuDeploy = createRokuDeploy(args);
        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice({} as RekeyDeviceOptions);
        }
        await rokuDeploy.sideload({} as SideloadOptions);
    }
}
