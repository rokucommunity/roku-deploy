import type { KeyDownOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class KeyDownCommand {
    async run(args) {
        await createRokuDeploy(args).keyDown({} as KeyDownOptions);
    }
}
