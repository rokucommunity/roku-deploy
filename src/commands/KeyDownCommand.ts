import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class KeyDownCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        await rokuDeploy.keyDown({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
