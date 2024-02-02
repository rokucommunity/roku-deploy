import { rokuDeploy } from '../index';

export class DeleteInstalledChannelCommand {
    async run(args) {
        await rokuDeploy.deleteDevChannel({
            host: args.host,
            password: args.password
        });
    }
}
