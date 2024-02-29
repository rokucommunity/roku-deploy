import { rokuDeploy } from '../index';

export class CreateSignedPackageCommand {
    async run(args) {
        await rokuDeploy.createSignedPackage({
            host: args.host,
            password: args.password,
            signingPassword: args.signingPassword,
            stagingDir: args.stagingDir
        });
    }
}
