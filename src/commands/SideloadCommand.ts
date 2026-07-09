import { rokuDeploy } from '../index';

export class SideloadCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };

        await rokuDeploy.sideload(options);
    }
}
