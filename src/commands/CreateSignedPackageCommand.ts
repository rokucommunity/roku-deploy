import { rokuDeploy, RokuDeploy } from '../index';

export class CreateSignedPackageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.createSignedPackage(options);
    }
}
