import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class KeyUpCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //keyUp is an ecp call (BaseEcpOptions): device/ecpPort/timeout, no password or cwd
        await rokuDeploy.keyUp(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout,
            key: args.key
        }));
    }
}
