import { rokuDeploy, util } from '../index';

export class GetDevIdCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        const devId = await rokuDeploy.getDevId(options);
        console.log(devId);
    }
}
