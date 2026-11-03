import { RokuDeploy } from '../index';
import type { StageOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class StageCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).stage({} as StageOptions);
    }
}
