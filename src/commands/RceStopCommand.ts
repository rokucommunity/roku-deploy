import { util } from '../util';
import { buildRceCommandContext, defaultRceWaitTimeoutSeconds, rceDeviceToTableObject, waitForRceDeviceStatus } from './commandUtils';

export class RceStopCommand {
    async run(args: any) {
        const { client, device } = await buildRceCommandContext(args);

        let result = await client.stopDevice({ deviceId: device.id });

        if (args.wait) {
            result = await waitForRceDeviceStatus(client, device.id, 'shutdown', args.timeout ?? defaultRceWaitTimeoutSeconds);
        }
        console.log(util.objectToTableString(rceDeviceToTableObject(result)));
    }
}
