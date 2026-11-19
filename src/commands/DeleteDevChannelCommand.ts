import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class DeleteDevChannelCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //deleteDevChannel is a password-auth device call (BaseRequestOptions): no ecpPort, no cwd
        await rokuDeploy.deleteDevChannel(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            username: args.username ?? config.username,
            password: args.password ?? config.password,
            packagePort: args.packagePort ?? config.packagePort,
            timeout: args.timeout ?? config.timeout
        }));
    }
}
