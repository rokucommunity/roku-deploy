import { rokuDeploy, util } from '../index';

export class StageCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (options.out) {
            options.stagingDir = options.out;
        }
        await rokuDeploy.stage(options);
    }
}
