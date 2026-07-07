import { rokuDeploy, RokuDeploy } from '../index';

export class KeyUpCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.keyUp(options);
    }
}
