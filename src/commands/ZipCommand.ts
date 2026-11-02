import type { ZipOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class ZipCommand {
    async run(args) {
        await createRokuDeploy(args).zip({} as ZipOptions);
    }
}
