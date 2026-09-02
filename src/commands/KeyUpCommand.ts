import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class KeyUpCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'keyUp');
        await rokuDeploy.keyUp(options);
    }
}
