import { rokuDeploy } from '../index';
import { util } from '../util';
import { loadCommandOptions } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        let options = loadCommandOptions(args, null);
        const outputPath = await rokuDeploy.getDeviceInfo(options);
        console.log(util.objectToTableString(outputPath));
    }
}
