import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class CreateSignedPackageCommand {
    async run(args) {
        let options = loadCommandOptions(args);
        await rokuDeploy.createSignedPackage(options);
    }
}
