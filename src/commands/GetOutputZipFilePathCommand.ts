import { rokuDeploy } from '../index';

export class GetOutputZipFilePathCommand {
    run(args) {
        const outputPath = rokuDeploy.getOutputZipFilePath({
            outFile: args.outFile,
            outDir: args.outDir
        });
        console.log(outputPath);
    }
}
