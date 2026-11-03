import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).sendText();
    }
}
