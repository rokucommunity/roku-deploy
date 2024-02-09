import { rokuDeploy } from '../index';

export class GetDevIdCommand {
    async run(args) {
        await rokuDeploy.getDevId({
            host: args.host
        });
    }
}
