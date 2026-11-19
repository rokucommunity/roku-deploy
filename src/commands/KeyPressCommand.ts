import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class KeyPressCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //keyPress is an ecp call (BaseEcpOptions): device/ecpPort/timeout, no password or cwd
        await rokuDeploy.keyPress(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout,
            key: args.key
        }));
    }
}
