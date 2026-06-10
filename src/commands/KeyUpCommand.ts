import { rokuDeploy, RokuDeploy } from '../index';

export class KeyUpCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.keyUp(options);
    }
}
