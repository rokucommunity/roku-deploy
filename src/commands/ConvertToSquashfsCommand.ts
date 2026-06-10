import { rokuDeploy, RokuDeploy } from '../index';

export class ConvertToSquashfsCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.convertToSquashfs(options);
    }
}
