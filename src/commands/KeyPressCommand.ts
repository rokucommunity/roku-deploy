import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class KeyPressCommand {
    async run(args) {
        let options = loadCommandOptions(args, null);
        await rokuDeploy.keyPress(options);
    }
}
