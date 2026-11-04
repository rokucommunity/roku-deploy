import * as path from 'path';
import { rokuDeploy } from '../index';
import { util } from '../util';
import type { DeviceStatus, RceDevice } from '../RceManagementClient';
import { RceManagementClient } from '../RceManagementClient';
import type { DeviceRegistryEntry, RokuDeployOptions } from '../RokuDeployOptions';

/**
 * Pull the options every device command shares out of a loaded rokudeploy.json, mapping the v3
 * `host` and `remotePort` keys onto `device` and `ecpPort`. Unset values are left off entirely: an
 * explicit `undefined` would mask the same setting on a devices-registry entry.
 */
export function extractCommonConfigOptions(config: RokuDeployOptions): Record<string, any> {
    const options: Record<string, any> = {
        device: config.device ?? (config.host ? { host: config.host } : undefined),
        devices: config.devices,
        username: config.username,
        password: config.password,
        packagePort: config.packagePort,
        ecpPort: config.ecpPort ?? config.remotePort,
        timeout: config.timeout
    };
    for (const key of Object.keys(options)) {
        if (options[key] === undefined) {
            delete options[key];
        }
    }
    return options;
}

/**
 * Translate the CLI args into library options. Every arg passes through as-is (the library ignores the
 * ones a call doesn't use), except:
 * - `--host`, `--esn` and `--instanceUrl` become an inline `device`; an RCE device carries `--rceToken`,
 *   falling back to the config file's `rceToken`.
 * - `undefined` values are dropped, so they can't override the config file's value.
 *
 * Returns `any`: nothing can prove statically that the user supplied a required option like `device`
 * or `password`, so the library's own runtime checks report those instead.
 */
export function normalizeCliArgs(args: Record<string, any>, config: RokuDeployOptions): any {
    const { host, esn, instanceUrl, rceToken, ...options } = args;
    for (const key of Object.keys(options)) {
        if (options[key] === undefined) {
            delete options[key];
        }
    }
    const token = rceToken ?? config.rceToken;
    if (typeof host === 'string') {
        options.device = { host: host };
    } else if (typeof esn === 'string') {
        options.device = { esn: esn, ...(token ? { rceToken: token } : {}) };
    } else if (typeof instanceUrl === 'string') {
        options.device = { instanceUrl: instanceUrl, ...(token ? { rceToken: token } : {}) };
    }
    return options;
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
    return rokuDeploy.loadConfigFile({
        cwd: args.cwd,
        configPath: typeof args.config === 'string' ? args.config : undefined
    });
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
