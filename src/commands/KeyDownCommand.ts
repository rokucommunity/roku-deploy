import { RokuDeploy } from '../index';
import type { KeyDownOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class KeyDownCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).keyDown({} as KeyDownOptions);
    }
}
