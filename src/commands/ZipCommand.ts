import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class ZipCommand {
    async run(args) {
        let options = loadCommandOptions(args);
        await rokuDeploy.zip(options);
    }
}
