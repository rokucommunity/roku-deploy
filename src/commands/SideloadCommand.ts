import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class SideloadCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };

        if (args.zip) {
            options.zip = path.resolve(args.cwd, args.zip);
        }
        if (args.rootDir) {
            options.rootDir = path.resolve(args.cwd, args.rootDir);
        }
        if (args.outZip) {
            options.outZip = path.resolve(args.cwd, args.outZip);
        }
        if (args.ecpPort) {
            options.remotePort = args.ecpPort;
        }

        await rokuDeploy.sideload(options);
    }
}
