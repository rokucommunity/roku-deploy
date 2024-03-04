import { rokuDeploy } from '../index';

export class KeyUpCommand {
    async run(args) {
        await rokuDeploy.keyUp(args.text);
    }
}
