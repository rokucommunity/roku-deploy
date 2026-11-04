import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, normalizeCliArgs } from './commandUtils';

export class ConvertToSquashfsCommand {
    async run(args) {
        const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });

        await rokuDeploy.convertToSquashfs({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config, [])
        });
    }
}
