import type { StageOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class StageCommand {
    async run(args) {
        await createRokuDeploy(args).stage({} as StageOptions);
    }
}
