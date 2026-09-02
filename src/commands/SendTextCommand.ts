import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'sendText');
        await rokuDeploy.sendText(options);
    }
}
