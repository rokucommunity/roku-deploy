import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, normalizeCliArgs } from './commandUtils';

export class StageCommand {
    async run(args) {
        const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });

        await rokuDeploy.stage({
            ...extractCommonConfigOptions(config),
            //stage-specific config options
            rootDir: config.rootDir,
            files: config.files,
            out: config.stagingDir ?? config.stagingFolderPath,
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config, ['rootDir', 'files', 'out'])
        });
    }
}
