import { rokuDeploy } from '../index';

export class GetOutputZipFilePathCommand {
    run(args) {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const outputPath = rokuDeploy['getOutputZipFilePath']({
            outFile: args.outFile,
            outDir: args.outDir
        });
        console.log(outputPath);
    }
}
