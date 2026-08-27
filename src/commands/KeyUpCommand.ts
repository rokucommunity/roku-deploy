import { rokuDeploy } from '../index';

export class KeyUpCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.keyUp(options);
    }
}
