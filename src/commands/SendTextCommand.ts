import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        let options = loadCommandOptions(args, null);
        await rokuDeploy.sendText(options);
    }
}
