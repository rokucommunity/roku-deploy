import { rokuDeploy, RokuDeploy } from '../index';

export class SideloadCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };

        await rokuDeploy.sideload(options);
    }
}
