import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class KeyDownCommand {
    async run(args) {
        let options = loadCommandOptions(args, null);
        await rokuDeploy.keyDown(options);
    }
}
