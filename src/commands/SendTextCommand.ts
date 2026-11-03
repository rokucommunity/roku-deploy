import { RokuDeploy } from '../index';
import type { SendTextOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).sendText({} as SendTextOptions);
    }
}
