import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, normalizeCliArgs } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });

        const { devId } = await rokuDeploy.getDevId({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config, [])
        });
        console.log(devId);
    }
}
