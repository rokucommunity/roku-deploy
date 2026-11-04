import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        const { devId } = await rokuDeploy.getDevId({
            ...extractCommonConfigOptions(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
        console.log(devId);
    }
}
