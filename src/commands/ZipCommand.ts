import { RokuDeploy } from '../index';
import type { ZipOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class ZipCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        await rokuDeploy.zip({} as ZipOptions);
    }
}
