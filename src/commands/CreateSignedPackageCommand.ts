import { rokuDeploy } from '../index';

export class CreateSignedPackageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.createSignedPackage(options);
    }
}
