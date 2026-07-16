import { rokuDeploy, util } from '../index';

export class GetDeviceInfoCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        const outputPath = await rokuDeploy.getDeviceInfo(options);
        console.log(util.objectToTableString(outputPath));
    }
}
