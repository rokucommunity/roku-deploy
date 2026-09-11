import { rokuDeploy, util } from '../index';
import * as path from 'path';
import { loadCommandOptions } from './commandUtils';

export class RekeyDeviceCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'rekey');
        if (args.pkg) {
            options.pkg = util.standardizePath(
                path.resolve(args.cwd, args.pkg)
            );
        }
        await rokuDeploy.rekeyDevice(options);
    }
}
