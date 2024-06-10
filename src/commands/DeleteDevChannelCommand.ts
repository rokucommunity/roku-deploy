import { rokuDeploy, util } from '../index';

export class DeleteDevChannelCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.deleteDevChannel(options);
    }
}
