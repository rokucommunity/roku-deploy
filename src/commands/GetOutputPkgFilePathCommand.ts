import { rokuDeploy, util } from '../index';

export class GetOutputPkgFilePathCommand {
    run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const outputPath = rokuDeploy['getOutputPkgPath'](options); //TODO fix this?
        console.log(outputPath);
    }
}
