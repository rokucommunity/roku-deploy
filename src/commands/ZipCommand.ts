import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class ZipCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (args.out) {
            args.out = path.resolve(args.cwd, args.out);
            options.outDir = path.dirname(args.out);
            options.outFile = path.basename(args.out);
        }
        if (args.dir) {
            options.dir = path.resolve(args.cwd, args.dir);
        }
        await rokuDeploy.zip(options);
    }
}
