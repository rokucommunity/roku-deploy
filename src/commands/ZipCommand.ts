import { rokuDeploy } from '../index';

export class ZipCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.zip(options);
    }
}
