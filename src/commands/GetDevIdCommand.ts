import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        const { devId } = await rokuDeploy.getDevId();
        console.log(devId);
    }
}
