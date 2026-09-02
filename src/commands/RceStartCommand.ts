import { util } from '../index';
import type { RceDevice, Snapshot } from '../RceManagementClient';
import { buildRceCommandContext, defaultRceWaitTimeoutSeconds, rceDeviceToTableObject, resolveRceDevice, waitForRceDeviceStatus } from './rceCommandUtils';

export class RceStartCommand {
    async run(args: any) {
        const { options, client } = buildRceCommandContext(args);
        const device = await resolveRceDevice(client, options);

        let snapshots: Snapshot[] | undefined;
        const listSnapshots = async () => {
            snapshots ??= await client.listSnapshots({ deviceId: device.id, items: 0 });
            return snapshots;
        };

        const snapshotId = options.snapshotId ?? (await this.resolveSnapshotId(options.snapshot, device, listSnapshots));

        //firmware resolution: explicit flag, then the chosen snapshot's firmware, then the
        //device's, then the first one available for the device's type
        let firmwareVersionId: string | undefined = options.firmwareVersionId;
        if (!firmwareVersionId) {
            firmwareVersionId = (await listSnapshots()).find(x => x.id === snapshotId)?.firmwareVersionId ?? device.firmwareVersionId ?? undefined;
            if (!firmwareVersionId) {
                const firmwareVersions = await client.listFirmwareVersions({ items: 0 });
                firmwareVersionId = firmwareVersions.find(x => x.deviceType === device.deviceType)?.firmwareVersionId;
            }
        }
        if (!firmwareVersionId) {
            throw new Error(`No firmware version is available for device type '${device.deviceType}'`);
        }

        let result = await client.startDevice({
            deviceId: device.id,
            start: {
                snapshotId: snapshotId,
                firmwareVersionId: firmwareVersionId,
                maxRuntime: options.maxRuntime ?? 3600
            }
        });

        if (options.wait) {
            result = await waitForRceDeviceStatus(client, device.id, 'running', options.timeout ?? defaultRceWaitTimeoutSeconds);
        }
        console.log(util.objectToTableString(rceDeviceToTableObject(result)));
    }

    /**
     * Resolve the snapshot to boot from: `--snapshot <name>` matches by name (`live` selects the
     * live snapshot), and with no flag the live snapshot is used. The device's last snapshot is
     * deliberately NOT a fallback — stopping a device saves its state to `live`, so booting the
     * last-loaded snapshot would silently revert that state.
     */
    private async resolveSnapshotId(snapshotName: string | undefined, device: RceDevice, listSnapshots: () => Promise<Snapshot[]>): Promise<number> {
        const snapshots = await listSnapshots();
        if (snapshotName === undefined || snapshotName === 'live') {
            const live = snapshots.find(x => x.live);
            if (!live) {
                throw new Error(`Device '${device.name}' has no live snapshot; pass --snapshot or --snapshotId to pick one`);
            }
            return live.id;
        }
        const matches = snapshots.filter(x => x.name === snapshotName);
        if (matches.length === 0) {
            throw new Error(`Device '${device.name}' has no snapshot named '${snapshotName}'`);
        }
        if (matches.length > 1) {
            throw new Error(`Device '${device.name}' has ${matches.length} snapshots named '${snapshotName}'; pass --snapshotId to pick one`);
        }
        return matches[0].id;
    }
}
