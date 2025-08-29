import { rokuDeploy, util } from '../index';
import type { CloseChannelOptions } from '../RokuDeploy';

export class SideloadCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.sideload(options);
        if (args.noclose !== true) {
            await rokuDeploy.closeChannel(options as CloseChannelOptions);
        }
    }
}
