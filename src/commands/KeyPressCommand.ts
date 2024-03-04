import { rokuDeploy } from '../index';

export class KeyPressCommand {
    async run(args) {
        await rokuDeploy.keyPress(args.text);
    }
}
