import { RokuDeploy } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        const { devId } = await new RokuDeploy(normalizeCliArgs(args)).getDevId();
        console.log(devId);
    }
}
