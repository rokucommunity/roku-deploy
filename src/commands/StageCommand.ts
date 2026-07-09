import { rokuDeploy } from '../index';

export class StageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.stage(options);
    }
}
