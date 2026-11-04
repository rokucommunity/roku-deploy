import { RokuDeploy } from '../index';
import type { KeyUpOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class KeyUpCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        await rokuDeploy.keyUp({} as KeyUpOptions);
    }
}
