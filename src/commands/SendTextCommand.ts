import { rokuDeploy, RokuDeploy } from '../index';

export class SendTextCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.sendText(options);
    }
}
