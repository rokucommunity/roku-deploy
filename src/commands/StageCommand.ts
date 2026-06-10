import { rokuDeploy, RokuDeploy } from '../index';

export class StageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.stage(options);
    }
}
