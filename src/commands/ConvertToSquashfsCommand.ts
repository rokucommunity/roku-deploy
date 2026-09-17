import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class ConvertToSquashfsCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'squash');
        await rokuDeploy.convertToSquashfs(options);
    }
}
