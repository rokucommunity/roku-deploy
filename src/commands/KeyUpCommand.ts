import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class KeyUpCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).keyUp();
    }
}
