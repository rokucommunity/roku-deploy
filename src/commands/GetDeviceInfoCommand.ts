import { rokuDeploy, RokuDeploy, util } from '../index';

export class GetDeviceInfoCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        const outputPath = await rokuDeploy.getDeviceInfo(options);
        console.log(util.objectToTableString(outputPath));
    }
}
