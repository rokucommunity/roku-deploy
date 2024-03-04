import { rokuDeploy } from '../index';

export class KeyDownCommand {
    async run(args) {
        await rokuDeploy.keyDown(args.text);
    }
}
