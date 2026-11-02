import type { ConvertToSquashfsOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class ConvertToSquashfsCommand {
    async run(args) {
        await createRokuDeploy(args).convertToSquashfs({} as ConvertToSquashfsOptions);
    }
}
