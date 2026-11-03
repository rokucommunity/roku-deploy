import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class ConvertToSquashfsCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).convertToSquashfs();
    }
}
