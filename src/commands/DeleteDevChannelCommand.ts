import { createRokuDeploy } from './commandUtils';

export class DeleteDevChannelCommand {
    async run(args) {
        await createRokuDeploy(args).deleteDevChannel();
    }
}
