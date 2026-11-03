import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class ZipCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).zip();
    }
}
