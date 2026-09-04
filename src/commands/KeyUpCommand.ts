import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class KeyUpCommand {
    async run(args) {
        let options = loadCommandOptions(args, null);
        await rokuDeploy.keyUp(options);
    }
}
