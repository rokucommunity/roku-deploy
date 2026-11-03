import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class KeyPressCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).keyPress();
    }
}
