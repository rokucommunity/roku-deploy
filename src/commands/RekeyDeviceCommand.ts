import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class RekeyDeviceCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //rekey targets a device by password (BaseRequestOptions), so no ecpPort. Config `rekeySignedPackage`
        //maps to the `pkg` option; the library resolves a relative pkg against cwd itself.
        await rokuDeploy.rekeyDevice(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            username: args.username ?? config.username,
            password: args.password ?? config.password,
            packagePort: args.packagePort ?? config.packagePort,
            timeout: args.timeout ?? config.timeout,
            pkg: args.pkg ?? config.rekeySignedPackage,
            signingPassword: args.signingPassword ?? config.signingPassword,
            devId: args.devId ?? config.devId,
            cwd: args.cwd
        }));
    }
}
