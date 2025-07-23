import { rokuDeploy, util } from '../index';

export class KeyDownCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.keyDown(options);
    }
}
