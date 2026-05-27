import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class StageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (args.out) {
            options.stagingDir = path.resolve(args.cwd, args.out);
        }
        await rokuDeploy.stage(options);
    }
}
