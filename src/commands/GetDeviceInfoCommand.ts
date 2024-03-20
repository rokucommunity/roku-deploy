import { rokuDeploy } from '../index';
import { util } from '../util';

export class GetDeviceInfoCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        const outputPath = await rokuDeploy.getDeviceInfo(options);
        console.log(util.objectToTableString(outputPath));
    }
}
