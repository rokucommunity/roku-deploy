import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        let options = loadCommandOptions(args, null);
        const { devId } = await rokuDeploy.getDevId(options);
        console.log(devId);
    }
}
