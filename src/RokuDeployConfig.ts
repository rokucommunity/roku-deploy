import type { LogLevel, LogLevelNumeric } from '@rokucommunity/logger';
import type { DeviceOption } from './DeviceConfig';
import type { DeviceRegistryEntry, FileEntry } from './RokuDeployOptions';
import type {
    CaptureScreenshotOptions,
    ConvertToSquashfsOptions,
    CreateSignedPackageOptions,
    DeleteDevChannelOptions,
    RekeyDeviceOptions,
    SideloadOptions,
    StageOptions,
    ZipOptions
} from './RokuDeploy';

/**
 * The shape of a `rokudeploy.json` config file: root-level common values (device, credentials,
 * ports) that apply to every command, plus optional per-command sections that override them.
 * Sections exist because option names collide across commands (`stage.out` is the staging folder,
 * `zip.out` is the zip path) — a flat file cannot express a full workflow.
 *
 * Per-command precedence: CLI args → `[command]` section → root level → defaults.
 * @public
 */
export interface RokuDeployConfig {
    //---- root-level common values, applied to every command ----

    /**
     * The target device. Can be a registry name (string) or an inline device config.
     * @example 'living-room'
     * @example { host: '192.168.1.21' }
     */
    device?: DeviceOption;
    /**
     * A registry of named devices. Keys are device names, values are device configurations.
     * @example { 'living-room': { host: '192.168.1.21', password: 'aaaa' } }
     */
    devices?: Record<string, DeviceRegistryEntry>;
    /**
     * The username for the roku box. This will always be 'rokudev', but allows to be overridden
     * just in case roku adds support for custom usernames in the future
     */
    username?: string;
    /**
     * The password for logging in to the developer portal on the target Roku device
     */
    password?: string;
    /**
     * The port that should be used when installing the package. Defaults to 80.
     */
    packagePort?: number;
    /**
     * The port used to send remote control commands (like home press, back, etc.). Defaults to 8060.
     */
    ecpPort?: number;
    /**
     * The timeout for each network request to the device, in milliseconds
     */
    timeout?: number;
    /**
     * The default RCE bearer token for Roku Cloud Emulator devices whose config carries no
     * rceToken of its own
     */
    rceToken?: string;
    /**
     * The root path to the folder holding your Roku project's source files
     */
    rootDir?: string;
    /**
     * An array of source file paths, globs, or {src,dest} objects for staging/zipping
     */
    files?: FileEntry[];
    /**
     * The working directory used to resolve relative paths
     */
    cwd?: string;
    /**
     * The log level
     */
    logLevel?: LogLevel | LogLevelNumeric;

    //---- per-command sections (keyed by CLI command name), override root on collision ----
    //only commands whose options are worth persisting get a section; per-invocation values
    //(key presses, text) and interactive commands deliberately have none

    /** Options applied only to the `sideload` command */
    sideload?: Partial<SideloadOptions>;
    /** Options applied only to the `stage` command */
    stage?: Partial<StageOptions>;
    /** Options applied only to the `zip` command */
    zip?: Partial<ZipOptions>;
    /** Options applied only to the `squash` command */
    squash?: Partial<ConvertToSquashfsOptions>;
    /** Options applied only to the `rekey` command */
    rekey?: Partial<RekeyDeviceOptions>;
    /** Options applied only to the `package` command */
    package?: Partial<CreateSignedPackageOptions>;
    /** Options applied only to the `deleteDevChannel` command */
    deleteDevChannel?: Partial<DeleteDevChannelOptions>;
    /** Options applied only to the `screenshot` command */
    screenshot?: Partial<CaptureScreenshotOptions>;
    /** Options applied only to the `rce start` command */
    'rce.start'?: RceStartConfig;
    /** Options applied only to the `rce stop` command */
    'rce.stop'?: RceStopConfig;
}

/**
 * Config-file options for the `rce start` command.
 * @public
 */
export interface RceStartConfig {
    /** The RCE bearer token (root-level `rceToken` is the usual home for this) */
    token?: string;
    /** The numeric management-api id of the RCE device */
    deviceId?: number;
    /** The serial number (ESN) of the RCE device */
    esn?: string;
    /** The name of the snapshot to boot from (`live` selects the live snapshot) */
    snapshot?: string;
    /** The id of the snapshot to boot from */
    snapshotId?: number;
    /** The firmware to boot with */
    firmwareVersionId?: string;
    /** The maximum runtime for the device instance, in seconds */
    maxRuntime?: number;
    /** Wait for the device to reach the 'running' status before exiting */
    wait?: boolean;
    /** How long --wait polls before giving up, in seconds */
    timeout?: number;
}

/**
 * Config-file options for the `rce stop` command.
 * @public
 */
export interface RceStopConfig {
    /** The RCE bearer token (root-level `rceToken` is the usual home for this) */
    token?: string;
    /** The numeric management-api id of the RCE device */
    deviceId?: number;
    /** The serial number (ESN) of the RCE device */
    esn?: string;
    /** Wait for the device to reach the 'shutdown' status before exiting */
    wait?: boolean;
    /** How long --wait polls before giving up, in seconds */
    timeout?: number;
}

/**
 * The section names recognized in a `rokudeploy.json` file — every key of `RokuDeployConfig`
 * that holds per-command options rather than a root-level value.
 * @public
 */
export const configSectionNames = [
    'sideload',
    'stage',
    'zip',
    'squash',
    'rekey',
    'package',
    'deleteDevChannel',
    'screenshot',
    'rce.start',
    'rce.stop'
] as const;

/**
 * A recognized per-command section name in a `rokudeploy.json` file.
 * @public
 */
export type ConfigSectionName = typeof configSectionNames[number];
