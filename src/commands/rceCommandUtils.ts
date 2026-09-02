import { util } from '../index';
import type { DeviceStatus, RceDevice } from '../RceManagementClient';
import { RceManagementClient } from '../RceManagementClient';
import type { ConfigSectionName } from '../RokuDeployConfig';
import type { DeviceRegistryEntry } from '../RokuDeployOptions';
import { loadCommandOptions } from './commandUtils';

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
 * The token comes from `--token`, falling back to the target device's registry entry, then
 * to `rceToken` from rokudeploy.json.
 */
export function buildRceCommandContext(args: any, command: ConfigSectionName) {
    const options = loadCommandOptions(args, command);
    const token = options.token ?? resolveRegistryEntry(options)?.rceToken ?? options.rceToken;
    if (!token) {
        throw new Error('An RCE token is required. Pass --token or set "rceToken" in rokudeploy.json');
    }
    const client = new RceManagementClient({ token: token });
    return { options: options, client: client };
}

/**
 * Look up the device registry entry named by `device` (if it IS a registry name — an inline
 * device config object passes through as-is). Returns undefined when no device is named.
 */
function resolveRegistryEntry(options: { device?: string | DeviceRegistryEntry; devices?: Record<string, DeviceRegistryEntry> }): DeviceRegistryEntry | undefined {
    if (typeof options.device === 'string') {
        const entry = options.devices?.[options.device];
        if (!entry) {
            throw new Error(`Device '${options.device}' was not found in the devices registry`);
        }
        return entry;
    }
    return options.device;
}

/**
 * Resolve the target device from `--deviceId`, `--esn`, or `--device` (a devices-registry name
 * or inline device config whose entry carries an `id` or `esn`).
 */
export async function resolveRceDevice(client: RceManagementClient, options: { deviceId?: number; esn?: string; device?: string | DeviceRegistryEntry; devices?: Record<string, DeviceRegistryEntry> }): Promise<RceDevice> {
    let { deviceId, esn } = options;
    if (deviceId === undefined && !esn) {
        const entry = resolveRegistryEntry(options);
        if (entry) {
            deviceId = entry.id;
            esn = entry.esn;
            if (deviceId === undefined && !esn) {
                throw new Error(`Device '${typeof options.device === 'string' ? options.device : JSON.stringify(options.device)}' is not an RCE device (needs an 'id' or 'esn')`);
            }
        }
    }
    if (deviceId !== undefined) {
        return client.getDevice({ deviceId: deviceId });
    }
    if (esn) {
        const device = await client.findDeviceByEsn({ esn: esn });
        if (!device) {
            throw new Error(`No RCE device found with esn '${esn}'`);
        }
        return device;
    }
    throw new Error('A device is required. Pass --deviceId, --esn, or --device');
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
