import { rokuDeploy } from '../index';

export class SignExistingPackageCommand {
    async run(args) {
        await rokuDeploy.signPackage({
            host: args.host,
            password: args.password,
            signingPassword: args.signingPassword,
            stagingDir: args.stagingDir
        });
    }
}
