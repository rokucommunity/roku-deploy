import type { SendTextOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        await createRokuDeploy(args).sendText({} as SendTextOptions);
    }
}
