import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class CreateSignedPackageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (args.out) {
            if (!args.out.endsWith('.pkg')) {
                throw new Error('Out must end with a .pkg');
            }
            args.out = path.resolve(args.cwd, args.out);
            options.outDir = path.dirname(args.out);
            options.outFile = path.basename(args.out);
        }
        await rokuDeploy.createSignedPackage(options);
    }
}
