import { rokuDeploy } from '../index';

export class RetrieveSignedPackageCommand {
    async run(args) {
        await rokuDeploy.retrieveSignedPackage(args.pathToPkg, {
            host: args.host,
            password: args.password,
            outFile: args.outFile
        });
    }
}
