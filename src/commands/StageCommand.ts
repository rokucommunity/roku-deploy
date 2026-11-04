import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class StageCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        await rokuDeploy.stage({
            ...extractCommonConfigOptions(config),
            //stage-specific config options
            rootDir: config.rootDir,
            files: config.files,
            out: config.stagingDir ?? config.stagingFolderPath,
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
