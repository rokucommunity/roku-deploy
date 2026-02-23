import { rokuDeploy, util } from '../index';

export class SendTextCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.sendText(options);
    }
}
