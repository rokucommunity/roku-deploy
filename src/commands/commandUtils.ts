import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { rokuDeploy } from '../index';
import { util } from '../util';
import type { DeviceStatus, RceDevice } from '../RceManagementClient';
import { RceManagementClient } from '../RceManagementClient';
import type { DeviceRegistryEntry } from '../RokuDeployOptions';

/**
 * Build the effective options for one CLI command: load `rokudeploy.json` (from `--config` or
 * cwd; skipped entirely with `--no-config`), then merge the CLI args on top.
 * Precedence: CLI args → config file → defaults. Pass `quiet` to skip announcing the config file.
 */
export function loadCommandOptions<T = any>(args: any, options?: { quiet?: boolean }): T {
    args.cwd ??= process.cwd();
    let result: Record<string, any>;
    //--no-config: bypass config auto-detection entirely
    if (args.config === false) {
        result = mapCliArgsToLibraryOptions({ ...args });
    } else {
        const configPath = args.config ?? path.join(args.cwd, 'rokudeploy.json');
        //announce which config file feeds this run (even without --verbose) so file-supplied values
        //are never an invisible input; greppable in CI logs
        if (!options?.quiet && fsExtra.existsSync(configPath)) {
            console.log(`Using config: ${configPath}`);
        }
        result = mapCliArgsToLibraryOptions({
            ...rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: configPath }),
            ...args
        });
    }
    //loadConfigFile applies the file's logLevel; an explicit --logLevel still wins on the command line
    if (args.logLevel !== undefined) {
        rokuDeploy.logger.logLevel = args.logLevel;
    }
    return result as T;
}

/**
 * The config file a `--help` run would read, honoring `--cwd`, `--config` and `--no-config`: its absolute
 * path and its parsed values. Undefined when help was not requested, when config
 * loading is off, or when the file is missing or unparseable (the latter is reported by the real run).
 */
function findHelpConfig(argv: string[]): { path: string; values: Record<string, any> } | undefined {
    if (!argv.includes('--help') && !argv.includes('-h') || argv.includes('--no-config')) {
        return undefined;
    }
    const flag = (name: string) => {
        const index = argv.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
        if (index < 0) {
            return undefined;
        }
        return argv[index].includes('=') ? argv[index].split('=').slice(1).join('=') : argv[index + 1];
    };
    const cwd = flag('cwd') ?? process.cwd();
    const name = flag('config') ?? 'rokudeploy.json';
    const configPath = path.resolve(cwd, name);
    if (!fsExtra.existsSync(configPath)) {
        return undefined;
    }
    try {
        return { path: configPath, values: rokuDeploy.loadConfigFile({ cwd: cwd, configPath: configPath }) };
    } catch {
        return undefined;
    }
}

/**
 * A command description for `--help` that, when a config file is found, adds a second paragraph naming
 * it (relative to cwd when it lives there). Only for help on that command (`argv` carries its name), so
 * the root command list stays one line each.
 */
export function helpDescription(command: string, description: string, argv: string[] = process.argv): string {
    const config = argv.includes(command) ? findHelpConfig(argv) : undefined;
    if (!config) {
        return description;
    }
    const cwd = process.cwd();
    const shown = config.path.startsWith(cwd + path.sep) ? `./${path.relative(cwd, config.path)}` : config.path;
    return `${description}\n\nUsing config: ${shown}`;
}

/**
 * For `--help` only: tag every option that the config file supplies with `[default: from config]`, so the
 * reader can see which values the command will pick up without the values themselves being printed.
 * `--host`/`--esn`/`--instanceUrl` are tagged when the file's `device` covers them. Call it first in a
 * command builder: it wraps `option()` so each declaration that follows picks up the tag.
 */
export function describeConfigValues<T extends { option: (key: string, def: Record<string, any>) => T }>(builder: T, argv: string[] = process.argv): T {
    const config = findHelpConfig(argv);
    if (!config) {
        return builder;
    }
    const supplied = new Set(Object.keys(config.values));
    if (typeof config.values.device === 'string') {
        ['host', 'esn', 'instanceUrl'].forEach(key => supplied.add(key));
    } else if (config.values.device) {
        Object.keys(config.values.device).forEach(key => supplied.add(key));
    }
    const declare = builder.option.bind(builder);
    builder.option = (key, def) => declare(key, supplied.has(key) ? { ...def, defaultDescription: 'from config' } : def);
    return builder;
}

/**
 * Translate CLI-only flag names into the option names the library understands. `--host`, `--esn` and
 * `--instanceUrl` each become an inline `device` config (winning over any `device` from the config file,
 * since CLI args take precedence); `--rceToken` (or the config file's root `rceToken`) rides along on an
 * RCE device so the library can authenticate with it.
 */
function mapCliArgsToLibraryOptions<T extends Record<string, any>>(options: T): T {
    const { host, esn, instanceUrl, ...remainingOptions } = options;
    if (typeof host === 'string') {
        return { ...remainingOptions, device: { host: host } } as unknown as T;
    }
    const rceToken = remainingOptions.rceToken as string | undefined;
    if (typeof esn === 'string') {
        return { ...remainingOptions, device: { esn: esn, ...(rceToken ? { rceToken: rceToken } : {}) } } as unknown as T;
    }
    if (typeof instanceUrl === 'string') {
        return { ...remainingOptions, device: { instanceUrl: instanceUrl, ...(rceToken ? { rceToken: rceToken } : {}) } } as unknown as T;
    }
    return options;
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
 * Merge the config file with the CLI args and build an authenticated management client.
 * The token comes from `--token`, falling back to the target device's registry entry, then
 * to `rceToken` from rokudeploy.json.
 */
export function buildRceCommandContext(args: any) {
    const options = loadCommandOptions(args);
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
