import { rokuDeploy } from '../index';
import { loadFlowStepOptions } from './commandUtils';

/**
 * `package` orchestrates the "ship a signed build" flow: the optional steps run in the fixed order
 * rekey -> sideload -> squash before the package is created.
 */
export class CreateSignedPackageCommand {
    async run(args) {
        let announced = false;
        const load = (section: 'rekey' | 'sideload' | 'squash' | 'package') => {
            const options = loadFlowStepOptions(args, section, announced);
            announced = true;
            return options;
        };
        if (args.rekey) {
            await rokuDeploy.rekeyDevice(load('rekey'));
        }
        if (args.sideload) {
            await rokuDeploy.sideload(load('sideload'));
        }
        if (args.squash) {
            await rokuDeploy.convertToSquashfs(load('squash'));
        }
        await rokuDeploy.createSignedPackage(load('package'));
    }
}
