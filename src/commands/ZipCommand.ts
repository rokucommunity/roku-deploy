import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, getConfigOutPath, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class ZipCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        await rokuDeploy.zip({
            ...extractCommonConfigOptions(config),
            //zip-specific config options
            dir: config.stagingDir ?? config.stagingFolderPath,
            out: getConfigOutPath(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
