import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class KeyDownCommand {
    async run(args) {
        let options = loadCommandOptions(args);
        await rokuDeploy.keyDown(options);
    }
}
