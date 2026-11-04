import { util } from '../util';
import { createRceClient, defaultRceWaitTimeoutSeconds, loadRokuDeployJson, rceDeviceToTableObject, resolveRceDevice, resolveRegistryEntry, waitForRceDeviceStatus } from './commandUtils';

export class RceStopCommand {
    async run(args: any) {
        const config = loadRokuDeployJson(args);

        const target = {
            deviceId: args.deviceId,
            esn: args.esn,
            //--deviceId/--esn pick the device directly; otherwise --device (or the config file's device) names it
            device: args.deviceId === undefined && !args.esn ? args.device ?? config.device : undefined,
            devices: config.devices
        };
        //token precedence: --token, then the targeted registry entry's rceToken, then the config file's rceToken
        const client = createRceClient(args.token ?? resolveRegistryEntry(target)?.rceToken ?? config.rceToken);
        const device = await resolveRceDevice(client, target);

        let result = await client.stopDevice({ deviceId: device.id });

        if (args.wait) {
            result = await waitForRceDeviceStatus(client, device.id, 'shutdown', args.timeout ?? defaultRceWaitTimeoutSeconds);
        }
        console.log(util.objectToTableString(rceDeviceToTableObject(result)));
    }
}
