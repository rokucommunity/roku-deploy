import { util } from '../index';
import type { Snapshot } from '../RceManagementClient';
import { buildRceCommandContext, defaultRceWaitTimeoutSeconds, rceDeviceToTableObject, resolveRceDevice, waitForRceDeviceStatus } from './rceCommandUtils';

export class RceStartDeviceCommand {
    async run(args: any) {
        const { options, client } = buildRceCommandContext(args);
        const device = await resolveRceDevice(client, options);

        //snapshot resolution: explicit flag, then the device's live snapshot (its current disk
        //state), then its last snapshot
        let snapshotId: number | undefined = options.snapshotId;
        let snapshots: Snapshot[] | undefined;
        if (!snapshotId) {
            snapshots = await client.listSnapshots({ deviceId: device.id, items: 0 });
            snapshotId = snapshots.find(x => x.live)?.id ?? device.last_snapshot_id ?? undefined;
        }
        if (!snapshotId) {
            throw new Error(`Device '${device.name}' has no snapshot to start from; create a snapshot before starting it`);
        }

        //firmware resolution: explicit flag, then the chosen snapshot's firmware, then the
        //device's, then the first one available for the device's type
        let firmwareVersionId: string | undefined = options.firmwareVersionId;
        if (!firmwareVersionId) {
            snapshots ??= await client.listSnapshots({ deviceId: device.id, items: 0 });
            firmwareVersionId = snapshots.find(x => x.id === snapshotId)?.firmware_version_id ?? device.firmware_version_id ?? undefined;
            if (!firmwareVersionId) {
                const firmwareVersions = await client.listFirmwareVersions({ items: 0 });
                firmwareVersionId = firmwareVersions.find(x => x.device_type === device.device_type)?.firmware_version_id;
            }
        }
        if (!firmwareVersionId) {
            throw new Error(`No firmware version is available for device type '${device.device_type}'`);
        }

        /* eslint-disable camelcase -- the RCE management api uses snake_case fields */
        let result = await client.startDevice({
            deviceId: device.id,
            start: {
                snapshot_id: snapshotId,
                firmware_version_id: firmwareVersionId,
                max_runtime: options.maxRuntime ?? 3600
            }
        });
        /* eslint-enable camelcase */

        if (options.wait) {
            result = await waitForRceDeviceStatus(client, device.id, 'running', options.waitTimeout ?? defaultRceWaitTimeoutSeconds);
        }
        console.log(util.objectToTableString(rceDeviceToTableObject(result)));
    }
}
