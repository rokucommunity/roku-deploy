import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class RekeyDeviceCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (args.pkg) {
            options.pkg = path.resolve(args.cwd, args.pkg);
        }
        await rokuDeploy.rekeyDevice(options);
    }
}
