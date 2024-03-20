import { rokuDeploy, util } from '../index';

export class CreateSignedPackageCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.createSignedPackage(options);
    }
}
