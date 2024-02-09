import { rokuDeploy } from '../index';
import { util } from '../util';

export class GetDeviceInfoCommand {
    async run(args) {
        const outputPath = await rokuDeploy.getDeviceInfo({
            host: args.host
        });
        console.log(util.objectToTableString(outputPath));
    }
}
