import { rokuDeploy } from '../index';

export class GetOutputPkgFilePathCommand {
    run(args) {
        const outputPath = rokuDeploy.getOutputPkgFilePath({
            outFile: args.outFile,
            outDir: args.outDir
        });
        console.log(outputPath);
    }
}
