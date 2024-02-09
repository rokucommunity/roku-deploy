import { rokuDeploy } from '../index';

export class CreatePackageCommand {
    async run(args) {
        await rokuDeploy.createPackage({
            stagingDir: args.stagingDir,
            outDir: args.outDir,
            rootDir: args.rootDir
        });
    }
}
