import { rokuDeploy } from '../index';

export class SendTextCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.sendText(options);
    }
}
