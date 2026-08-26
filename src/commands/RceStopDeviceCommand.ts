import { util } from '../index';
import { buildRceCommandContext, defaultRceWaitTimeoutSeconds, rceDeviceToTableObject, resolveRceDevice, waitForRceDeviceStatus } from './rceCommandUtils';

export class RceStopDeviceCommand {
    async run(args: any) {
        const { options, client } = buildRceCommandContext(args);
        const device = await resolveRceDevice(client, options);

        let result = await client.stopDevice({ deviceId: device.id });

        if (options.wait) {
            result = await waitForRceDeviceStatus(client, device.id, 'shutdown', options.waitTimeout ?? defaultRceWaitTimeoutSeconds);
        }
        console.log(util.objectToTableString(rceDeviceToTableObject(result)));
    }
}
