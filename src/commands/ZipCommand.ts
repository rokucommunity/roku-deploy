import { rokuDeploy, util } from '../index';

export class ZipCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.zip(options);
    }
}
