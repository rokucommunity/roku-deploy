import { rokuDeploy } from '../index';

export class GetOutputPkgFilePathCommand {
    run(args) {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const outputPath = rokuDeploy['getOutputPkgPath']({
            outFile: args.outFile,
            outDir: args.outDir
        });
        console.log(outputPath);
    }
}
