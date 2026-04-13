import { rokuDeploy, util } from '../index';

export class SideloadCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };

        await rokuDeploy.sideload(options);
    }
}
