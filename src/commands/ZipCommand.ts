import { rokuDeploy } from '../index';

export class ZipCommand {
    async run(args) {
        await rokuDeploy.zip({
            stagingDir: args.stagingDir,
            outDir: args.outDir
        });
    }
}
