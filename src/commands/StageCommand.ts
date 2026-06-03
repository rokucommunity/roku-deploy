import { rokuDeploy, util } from '../index';

export class StageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.stage(options);
    }
}
