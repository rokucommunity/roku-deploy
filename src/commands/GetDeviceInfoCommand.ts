import type { GetDeviceInfoOptions } from '../index';
import { util } from '../util';
import { createRokuDeploy } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        const outputPath = await createRokuDeploy(args).getDeviceInfo({} as GetDeviceInfoOptions);
        console.log(util.objectToTableString(outputPath));
    }
}
