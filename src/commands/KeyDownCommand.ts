import { rokuDeploy } from '../index';

export class KeyDownCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.keyDown(options);
    }
}
