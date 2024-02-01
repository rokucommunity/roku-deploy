import { rokuDeploy } from '../index';

export class GetDeviceInfoCommand {
    async run(args) {
        await rokuDeploy.getDeviceInfo({
            host: args.host
        });
    }
}
