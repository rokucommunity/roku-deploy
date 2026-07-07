import { rokuDeploy, RokuDeploy } from '../index';

export class KeyDownCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.keyDown(options);
    }
}
