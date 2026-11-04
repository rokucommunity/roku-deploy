import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class DeleteDevChannelCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        await rokuDeploy.deleteDevChannel({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
