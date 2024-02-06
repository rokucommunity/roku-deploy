import { rokuDeploy } from '../index';

export class ZipPackageCommand {
    async run(args) {
        await rokuDeploy.zipPackage({
            stagingDir: args.stagingDir,
            outDir: args.outDir
        });
    }
}
