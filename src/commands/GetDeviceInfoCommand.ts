import { RokuDeploy } from '../index';
import type { GetDeviceInfoOptions } from '../index';
import { util } from '../util';
import { normalizeCliArgs } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        const outputPath = await new RokuDeploy(normalizeCliArgs(args)).getDeviceInfo({} as GetDeviceInfoOptions);
        console.log(util.objectToTableString(outputPath));
    }
}
