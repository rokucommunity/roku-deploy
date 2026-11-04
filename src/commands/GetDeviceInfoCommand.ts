import { RokuDeploy } from '../index';
import { util } from '../util';
import { normalizeCliArgs } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        const outputPath = await rokuDeploy.getDeviceInfo();
        console.log(util.objectToTableString(outputPath));
    }
}
