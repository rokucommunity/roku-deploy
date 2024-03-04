import { rokuDeploy } from '../index';
import { util } from '../util';

export class ZipPackageCommand {
    async run(args) {
        const options = {
            ...util.getOptionsFromJson(),
            ...args
        };
        await rokuDeploy.zip(options);
    }
}
