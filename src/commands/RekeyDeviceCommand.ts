import { rokuDeploy } from '../index';
import { util } from '../util';
import * as path from 'path';

export class RekeyDeviceCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...rokuDeploy.loadConfigFile(args),
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
