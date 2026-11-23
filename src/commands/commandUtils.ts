import * as path from 'path';
import { rokuDeploy } from '../index';
import { util } from '../util';
import type { DeviceStatus, RceDevice } from '../RceManagementClient';
import { RceManagementClient } from '../RceManagementClient';
import type { DeviceRegistryEntry, RokuDeployOptions } from '../RokuDeployOptions';
import type { DeviceOption } from '../DeviceConfig';

/**
 * The device a command should target. A cli `--host`/`--esn`/`--instanceUrl` wins (an RCE address carries
 * `--rceToken`, falling back to the config's `rceToken`); otherwise the config's `device` (an inline config
 * or a registry name) is used, or the v3 `host` key as an inline device. Undefined when none is set, so the
 * library's own required-option check reports it.
 */
export function resolveDeviceOption(args: Record<string, any>, config: RokuDeployOptions): DeviceOption | undefined {
    const token = args.rceToken ?? config.rceToken;
    if (typeof args.host === 'string') {
        return { host: args.host };
    }
    if (typeof args.esn === 'string') {
        return { esn: args.esn, ...(token ? { rceToken: token } : {}) };
    }
    if (typeof args.instanceUrl === 'string') {
        return { instanceUrl: args.instanceUrl, ...(token ? { rceToken: token } : {}) };
    }
    //the v3 `host` key is normalized into `device` at load (see normalizeV3ConfigKeys)
    return config.device;
}

/**
 * Drop keys whose value is undefined or null, so a cli/config option left unset does not reach the method as an
 * explicit `undefined` (which would mask the same setting on the constructor or a devices-registry entry).
 * Command handlers list every option explicitly and wrap the result in this.
 */
export function definedOptions<T extends object>(options: T): T {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined && value !== null) {
            result[key] = value;
        }
    }
    return result as T;
}

/**
 * Rename the deprecated v3 rokudeploy.json keys to their v4 equivalents so command handlers only ever read
 * the current keys, instead of each repeating a v3 fallback. The v4 key wins when both are present. This
 * runs only on the cli path (loadRokuDeployJson); the library's loadConfigFile stays literal. `outDir`/
 * `outFile` are left alone — they are combined per command by getConfigOutPath.
 */
export function normalizeV3ConfigKeys(config: RokuDeployOptions): RokuDeployOptions {
    const normalized: Record<string, any> = { ...config };
    const rename = (v3: string, v4: string) => {
        if (normalized[v3] !== undefined && normalized[v4] === undefined) {
            normalized[v4] = normalized[v3];
        }
        delete normalized[v3];
    };
    rename('remotePort', 'ecpPort');
    rename('stagingFolderPath', 'stagingDir');
    rename('deleteInstalledChannel', 'deleteDevChannel');
    //host -> device is structural (a string becomes an inline device config)
    if (normalized.device === undefined && normalized.host !== undefined) {
        normalized.device = { host: normalized.host };
    }
    delete normalized.host;
    return normalized;
}

/**
 * The output file path from the config file's v3 `outDir`/`outFile` keys, or undefined when neither is set
 * (the library then uses its own default). The library adds the `.zip`/`.pkg` extension.
 */
export function getConfigOutPath(config: RokuDeployOptions): string | undefined {
    if (config.outDir === undefined && config.outFile === undefined) {
        return undefined;
    }
    return path.join(config.outDir ?? './out', config.outFile ?? 'roku-deploy');
}

/**
 * Load the rokudeploy.json a command should use, from its `--config` and `--cwd` args:
 * - `--no-config` (`config: false`) skips the file and returns an empty config
 * - `--config <path>` loads that file
 * - otherwise `rokudeploy.json` in `--cwd` (or the process cwd) is loaded, if it exists
 */
export function loadRokuDeployJson(args: { cwd?: string; config?: string | boolean }): RokuDeployOptions {
    if (args.config === false) {
        return {};
    }
    return normalizeV3ConfigKeys(rokuDeploy.loadConfigFile({
        cwd: args.cwd,
        configPath: typeof args.config === 'string' ? args.config : undefined
    }));
}

/**
 * How long (in seconds) `--wait` polls for a device to finish starting/stopping before giving up.
 */
export const defaultRceWaitTimeoutSeconds = 600;

/**
 * How often (in milliseconds) `--wait` polls the device status.
 */
export const rceWaitPollIntervalMs = 2000;

/**
 * Build an authenticated management client, failing with a helpful message when no token was found.
 */
export function createRceClient(token: string | undefined): RceManagementClient {
    if (!token) {
        throw new Error('An RCE token is required. Pass --token or set "rceToken" in rokudeploy.json');
    }
    return new RceManagementClient({ token: token });
}

/**
 * Look up the device registry entry named by `device` (if it IS a registry name — an inline
 * device config object passes through as-is). Returns undefined when no device is named.
 */
export function resolveRegistryEntry(options: { device?: string | DeviceRegistryEntry; devices?: Record<string, DeviceRegistryEntry> }): DeviceRegistryEntry | undefined {
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
