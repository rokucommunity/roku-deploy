import { rokuDeploy } from '../index';

export class DeleteDevChannelCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.deleteDevChannel(options);
    }
}
