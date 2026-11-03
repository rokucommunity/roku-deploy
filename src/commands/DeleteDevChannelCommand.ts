import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class DeleteDevChannelCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).deleteDevChannel();
    }
}
