import { rokuDeploy, util } from '../index';

export class PrepublishCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.stage(options);
    }
}
