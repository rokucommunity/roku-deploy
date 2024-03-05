import { rokuDeploy, util } from '../index';

export class RekeyDeviceCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.rekeyDevice(options);
    }
}
