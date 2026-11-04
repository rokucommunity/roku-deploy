import { rokuDeploy } from '../index';
import { util } from '../util';
import { extractCommonConfigOptions, normalizeCliArgs } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });

        const deviceInfo = await rokuDeploy.getDeviceInfo({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config, [])
        });
        console.log(util.objectToTableString(deviceInfo));
    }
}
