import { RokuDeploy } from '../index';
import type { SendTextOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        await rokuDeploy.sendText({} as SendTextOptions);
    }
}
