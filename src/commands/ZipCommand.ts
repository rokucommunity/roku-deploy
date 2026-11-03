import { RokuDeploy } from '../index';
import type { ZipOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class ZipCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).zip({} as ZipOptions);
    }
}
