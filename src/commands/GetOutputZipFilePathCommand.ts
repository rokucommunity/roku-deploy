import { rokuDeploy } from '../index';

export class GetOutputZipFilePathCommand {
    run(args) {
        rokuDeploy.getOutputZipFilePath({
            outFile: args.outFile,
            outDir: args.outDir
        });
    }
}
