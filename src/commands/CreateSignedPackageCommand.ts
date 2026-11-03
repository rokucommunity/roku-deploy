import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

/**
 * `package` orchestrates the "ship a signed build" flow: the optional steps run in the fixed order
 * rekey -> sideload -> squash before the package is created.
 */
export class CreateSignedPackageCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        if (args.rekey) {
            await rokuDeploy.rekeyDevice();
        }
        if (args.sideload) {
            await rokuDeploy.sideload();
        }
        //a production package should be squashed, so squash runs unless --no-squash (or a config
        //`squash: false`) opts out. `squash` is a CLI flag, not a library option, hence the untyped read
        if ((rokuDeploy.options as Record<string, any>).squash !== false) {
            await rokuDeploy.convertToSquashfs();
        }
        await rokuDeploy.createSignedPackage();
    }
}
