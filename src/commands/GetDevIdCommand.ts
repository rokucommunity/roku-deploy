import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'getDevId');
        const { devId } = await rokuDeploy.getDevId(options);
        console.log(devId);
    }
}
