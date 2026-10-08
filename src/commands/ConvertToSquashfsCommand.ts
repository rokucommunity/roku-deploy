import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class ConvertToSquashfsCommand {
    async run(args) {
        let options = loadCommandOptions(args);
        await rokuDeploy.convertToSquashfs(options);
    }
}
