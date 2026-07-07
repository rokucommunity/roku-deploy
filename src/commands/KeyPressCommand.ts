import { rokuDeploy, RokuDeploy } from '../index';

export class KeyPressCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.keyPress(options);
    }
}
