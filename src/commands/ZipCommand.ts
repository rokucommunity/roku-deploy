import { rokuDeploy, RokuDeploy } from '../index';

export class ZipCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.zip(options);
    }
}
