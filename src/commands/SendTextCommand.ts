import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class SendTextCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //sendText is an ecp call (BaseEcpOptions): device/ecpPort/timeout, no password or cwd
        await rokuDeploy.sendText(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout,
            text: args.text
        }));
    }
}
