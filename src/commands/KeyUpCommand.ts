import type { KeyUpOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class KeyUpCommand {
    async run(args) {
        await createRokuDeploy(args).keyUp({} as KeyUpOptions);
    }
}
