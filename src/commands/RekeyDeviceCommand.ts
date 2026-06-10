import { rokuDeploy, RokuDeploy, util } from '../index';
import * as path from 'path';

export class RekeyDeviceCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        if (args.pkg) {
            options.pkg = util.standardizePath(
                path.resolve(args.cwd, args.pkg)
            );
        }
        await rokuDeploy.rekeyDevice(options);
    }
}
