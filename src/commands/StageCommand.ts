import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class StageCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'stage');
        await rokuDeploy.stage(options);
    }
}
