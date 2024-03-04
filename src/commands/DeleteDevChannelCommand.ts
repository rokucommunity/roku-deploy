import { rokuDeploy } from '../index';

export class DeleteDevChannelCommand {
    async run(args) {
        await rokuDeploy.deleteDevChannel({
            host: args.host,
            password: args.password
        });
    }
}
