import { rokuDeploy } from '../index';
import { util } from '../util';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class GetDeviceInfoCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //getDeviceInfo is an ecp call (BaseEcpOptions): device/ecpPort/timeout, no password or cwd
        const deviceInfo = await rokuDeploy.getDeviceInfo(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout
        }));
        console.log(util.objectToTableString(deviceInfo));
    }
}
