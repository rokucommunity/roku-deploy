import { rokuDeploy } from '../index';

export class GetOutputPkgFilePathCommand {
    run(args) {
        rokuDeploy.getOutputPkgFilePath({
            outFile: args.outFile,
            outDir: args.outDir
        });
    }
}
