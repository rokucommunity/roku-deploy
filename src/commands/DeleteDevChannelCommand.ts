import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class DeleteDevChannelCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'deleteDevChannel');
        await rokuDeploy.deleteDevChannel(options);
    }
}
