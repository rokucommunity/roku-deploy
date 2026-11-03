import { RokuDeploy } from '../index';
import { util } from '../util';
import { normalizeCliArgs } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        const outputPath = await new RokuDeploy(normalizeCliArgs(args)).getDeviceInfo();
        console.log(util.objectToTableString(outputPath));
    }
}
