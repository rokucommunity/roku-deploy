import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class SideloadCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };

        // Resolve outZip to absolute path if provided
        if (args.outZip) {
            options.outZip = path.resolve(args.cwd, args.outZip);
        }

        await rokuDeploy.sideload(options);
    }
}
