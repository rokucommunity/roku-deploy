import { rokuDeploy, util } from '../index';

export class GetDevIdCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.getDevId(options);
    }
}
