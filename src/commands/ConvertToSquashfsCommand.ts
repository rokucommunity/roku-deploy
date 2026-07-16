import { rokuDeploy } from '../index';

export class ConvertToSquashfsCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.convertToSquashfs(options);
    }
}
