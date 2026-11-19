import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class KeyDownCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //keyDown is an ecp call (BaseEcpOptions): device/ecpPort/timeout, no password or cwd
        await rokuDeploy.keyDown(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout,
            key: args.key
        }));
    }
}
