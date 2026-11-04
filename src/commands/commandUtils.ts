import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { Argv } from 'yargs';
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
 * The config file a `--help` run would read, honoring the same `--cwd`, `--config` and `--no-config` flags
 * the command itself does, with its values. Undefined when help was not requested, when config loading is
 * off, or when the file is missing or unparseable (the real run reports the latter).
 */
export function findHelpConfig(argv: string[] = process.argv): { path: string; values: Record<string, any> } | undefined {
    if (!argv.includes('--help') || argv.includes('--no-config')) {
        return undefined;
    }
    const flag = (name: string) => {
        const index = argv.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
        if (index < 0) {
            return undefined;
        }
        return argv[index].includes('=') ? argv[index].split('=').slice(1).join('=') : argv[index + 1];
    };
    const cwd = path.resolve(flag('cwd') ?? process.cwd());
    const config = flag('config');
    //same resolution as the loader: an explicit --config is taken as given, the default lives in cwd
    const configPath = config ? path.resolve(config) : path.join(cwd, 'rokudeploy.json');
    if (!fsExtra.existsSync(configPath)) {
        return undefined;
    }
    try {
        return { path: configPath, values: loadRokuDeployJson({ cwd: cwd, config: config ?? true }) };
    } catch {
        return undefined;
    }
}

/**
 * The yargs `description` and `builder` for a command whose `--help` names the config file in play and the
 * keys it sets that this command reads (keys only, never values, so secrets stay out of the terminal). The
 * list is limited to the options the builder declares, plus `device` for commands that take `--host`,
 * `--esn` or `--instanceUrl`. Spread into `.command(name, ...hinted(name, description, builder), handler)`.
 */
export function hinted<T>(command: string, description: string, build: (builder: Argv<T>) => Argv<any>, argv: string[] = process.argv): [string, (builder: Argv<T>) => Argv<any>] {
    return [description, (builder) => {
        const built = build(builder);
        const config = command.split(' ').every(word => argv.includes(word)) ? findHelpConfig(argv) : undefined;
        if (config) {
            //getOptions() is not in the yargs typings but is a public method on the instance
            const declared = Object.keys((built as any).getOptions().key);
            if (['host', 'esn', 'instanceUrl'].some(name => declared.includes(name))) {
                declared.push('device');
            }
            const keys = Object.keys(config.values).filter(key => declared.includes(key));
            const cwd = process.cwd();
            const shown = config.path.startsWith(cwd + path.sep) ? `.${path.sep}${path.relative(cwd, config.path)}` : config.path;
            const lines = [`$0 ${command}`, '', description, '', `Using config: ${shown}`];
            if (keys.length > 0) {
                lines.push(`Using values from config: ${keys.join(', ')}`);
            }
            //yargs only fills in a command's usage when none was set, so this replaces the default header
            built.usage(lines.join('\n'));
        }
        return built;
    }];
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
