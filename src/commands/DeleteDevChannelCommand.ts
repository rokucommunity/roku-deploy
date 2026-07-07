import { rokuDeploy, RokuDeploy } from '../index';

export class DeleteDevChannelCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.deleteDevChannel(options);
    }
}
