import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class StageCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).stage();
    }
}
