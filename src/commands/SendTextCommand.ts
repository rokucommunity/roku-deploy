import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        await rokuDeploy.sendText({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
