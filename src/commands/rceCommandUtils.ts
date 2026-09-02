import { rokuDeploy, util } from '../index';
import type { DeviceStatus, RceDevice } from '../RceManagementClient';
import { RceManagementClient } from '../RceManagementClient';

/**
 * How long (in seconds) `--wait` polls for a device to finish starting/stopping before giving up.
 */
export const defaultRceWaitTimeoutSeconds = 600;

/**
 * How often (in milliseconds) `--wait` polls the device status.
 */
export const rceWaitPollIntervalMs = 2000;

/**
 * Merge the config file with the CLI args and build an authenticated management client.
 * The token comes from `--token`, falling back to `rceToken` from rokudeploy.json.
 */
export function buildRceCommandContext(args: any) {
    const options = {
        ...rokuDeploy.loadConfigFile(args),
        ...args
    };
    const token = options.token ?? options.rceToken;
    if (!token) {
        throw new Error('An RCE token is required. Pass --token or set "rceToken" in rokudeploy.json');
    }
    const client = new RceManagementClient({ token: token });
    return { options: options, client: client };
}

/**
 * Resolve the target device from `--deviceId` or `--esn`.
 */
export async function resolveRceDevice(client: RceManagementClient, options: { deviceId?: number; esn?: string }): Promise<RceDevice> {
    if (options.deviceId !== undefined) {
        return client.getDevice({ deviceId: options.deviceId });
    }
    if (options.esn) {
        const device = await client.findDeviceByEsn({ esn: options.esn });
        if (!device) {
            throw new Error(`No RCE device found with esn '${options.esn}'`);
        }
        return device;
    }
    throw new Error('A device is required. Pass --deviceId or --esn');
}

/**
 * Poll the device until it reaches the given status, throwing after the timeout elapses.
 */
export async function waitForRceDeviceStatus(client: RceManagementClient, deviceId: number, targetStatus: DeviceStatus, timeoutSeconds: number): Promise<RceDevice> {
    const deadline = Date.now() + (timeoutSeconds * 1000);
    while (true) {
        const device = await client.getDevice({ deviceId: deviceId });
        if (device.status === targetStatus) {
            return device;
        }
        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${timeoutSeconds} seconds waiting for device ${deviceId} to reach status '${targetStatus}' (current status '${device.status}')`);
        }
        await util.sleep(rceWaitPollIntervalMs);
    }
}

/**
 * Flatten a device into the fields worth showing after a start/stop, for `util.objectToTableString`.
 */
export function rceDeviceToTableObject(device: RceDevice): Record<string, any> {
    const result: Record<string, any> = {
        id: device.id,
        name: device.name,
        deviceType: device.deviceType,
        status: device.status,
        snapshotId: device.runningDevice?.snapshotId,
        firmwareVersionId: device.runningDevice?.firmwareVersionId,
        maxRuntime: device.runningDevice?.maxRuntime,
        instanceApiUrl: device.runningDevice?.instanceApiUrl
    };
    for (const key of Object.keys(result)) {
        if (result[key] === undefined || result[key] === null) {
            delete result[key];
        }
    }
    return result;
}
