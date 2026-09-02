import { rokuDeploy, util } from '../index';
import { loadCommandOptions } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'getDeviceInfo');
        const outputPath = await rokuDeploy.getDeviceInfo(options);
        console.log(util.objectToTableString(outputPath));
    }
}
