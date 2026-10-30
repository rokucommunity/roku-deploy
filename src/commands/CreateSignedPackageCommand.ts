import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

/**
 * `package` orchestrates the "ship a signed build" flow: the optional steps run in the fixed order
 * rekey -> sideload -> squash before the package is created.
 */
export class CreateSignedPackageCommand {
    async run(args) {
        const options = loadCommandOptions(args);
        if (args.rekey) {
            await rokuDeploy.rekeyDevice(options);
        }
        if (args.sideload) {
            await rokuDeploy.sideload(options);
        }
        //a production package should be squashed, so squash runs unless --no-squash (or a config
        //`squash: false`) opts out
        if (options.squash !== false) {
            await rokuDeploy.convertToSquashfs(options);
        }
        await rokuDeploy.createSignedPackage(options);
    }
}
