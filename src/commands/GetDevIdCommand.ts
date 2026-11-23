import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //getDevId is an ecp call (BaseEcpOptions): device/ecpPort/timeout, no password or cwd
        const { devId } = await rokuDeploy.getDevId(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout
        }));
        console.log(devId);
    }
}
