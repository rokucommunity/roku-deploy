import { rokuDeploy, util } from '../index';

export class ZipCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.zip(options);
    }
}
