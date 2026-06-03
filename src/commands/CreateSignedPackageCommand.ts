import { rokuDeploy, util } from '../index';

export class CreateSignedPackageCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.createSignedPackage(options);
    }
}
