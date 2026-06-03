import { rokuDeploy, util } from '../index';

export class ConvertToSquashfsCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.convertToSquashfs(options);
    }
}
