import type { KeyPressOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class KeyPressCommand {
    async run(args) {
        await createRokuDeploy(args).keyPress({} as KeyPressOptions);
    }
}
