import { RokuDeploy } from '../index';
import type { ConvertToSquashfsOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class ConvertToSquashfsCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        await rokuDeploy.convertToSquashfs({} as ConvertToSquashfsOptions);
    }
}
