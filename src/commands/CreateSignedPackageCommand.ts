import type { ConvertToSquashfsOptions, CreateSignedPackageOptions, RekeyDeviceOptions, SideloadOptions } from '../index';
import { createRokuDeploy, resolvedOptions } from './commandUtils';

/**
 * `package` orchestrates the "ship a signed build" flow: the optional steps run in the fixed order
 * rekey -> sideload -> squash before the package is created.
 */
export class CreateSignedPackageCommand {
    async run(args) {
        const rokuDeploy = createRokuDeploy(args);
        if (args.rekey) {
            await rokuDeploy.rekeyDevice({} as RekeyDeviceOptions);
        }
        if (args.sideload) {
            await rokuDeploy.sideload({} as SideloadOptions);
        }
        //a production package should be squashed, so squash runs unless --no-squash (or a config
        //`squash: false`) opts out
        if (resolvedOptions(rokuDeploy).squash !== false) {
            await rokuDeploy.convertToSquashfs({} as ConvertToSquashfsOptions);
        }
        await rokuDeploy.createSignedPackage({} as CreateSignedPackageOptions);
    }
}
