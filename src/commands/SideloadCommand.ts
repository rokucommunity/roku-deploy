import { rokuDeploy, util } from '../index';
import type { CloseChannelOptions } from '../RokuDeploy';

export class SideloadCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (args.noclose !== true) {
            await rokuDeploy.closeChannel(options as CloseChannelOptions);
        }

        if (args.zip) {
            args.retainDeploymentArchive = true;
            await rokuDeploy.sideload(options);
        } else if (args.rootDir) {
            await rokuDeploy.zip(options);
            args.retainDeploymentArchive = false;
            await rokuDeploy.sideload(options);
        } else {
            throw new Error('Either zip or rootDir must be provided for sideload command');
        }
    }
}
