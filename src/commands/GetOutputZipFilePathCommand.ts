import { rokuDeploy, util } from '../index';

export class GetOutputZipFilePathCommand {
    run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const outputPath = rokuDeploy['getOutputZipFilePath'](options);
        console.log(outputPath);
    }
}
