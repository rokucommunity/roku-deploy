import { rokuDeploy } from '../index';

export class DeleteInstalledChannelCommand {
    async run(args) {
        await rokuDeploy.deleteInstalledChannel({
            host: args.host,
            password: args.password
        });
    }
}
