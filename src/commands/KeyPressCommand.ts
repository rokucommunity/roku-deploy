import { rokuDeploy } from '../index';

export class KeyPressCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.keyPress(options);
    }
}
