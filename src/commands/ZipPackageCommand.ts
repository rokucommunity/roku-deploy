import { rokuDeploy } from '../index';

export class ZipPackageCommand {
    async run(args) {
        await rokuDeploy.zip({
            stagingDir: args.stagingDir,
            outDir: args.outDir
        });
    }
}
