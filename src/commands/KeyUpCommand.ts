import { rokuDeploy, util } from '../index';

export class KeyUpCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.keyUp(options);
    }
}
