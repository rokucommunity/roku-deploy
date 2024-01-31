import { rokuDeploy } from '../index';

export class RetrieveSignedPackageCommand {
    async run(args) {
        await rokuDeploy.retrieveSignedPackage('path_to_pkg', {
            host: args.host,
            password: args.password,
            outFile: args.outFile
        });
    }
}
