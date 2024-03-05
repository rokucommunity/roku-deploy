import { rokuDeploy, util } from '../index';

export class PublishCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.sideload(options);
    }
}
