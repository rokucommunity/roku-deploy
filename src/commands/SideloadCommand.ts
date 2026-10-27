import { rokuDeploy } from '../index';
import { loadFlowStepOptions } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice(loadFlowStepOptions(args, 'rekey', false));
        }
        await rokuDeploy.sideload(loadFlowStepOptions(args, 'sideload', !!args.rekey));
    }
}
