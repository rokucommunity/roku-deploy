import { rokuDeploy, util } from '../index';

export class KeyPressCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.keyPress(options);
    }
}
