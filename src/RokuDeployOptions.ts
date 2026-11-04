import type { Logger, LogLevel, LogLevelNumeric } from '@rokucommunity/logger';
import type { DeviceOption } from './DeviceConfig';

/**
 * The per-device settings a devices registry entry may override, applied whenever the entry is targeted by name.
 * Precedence: explicit per-call options > these entry settings > constructor options.
 * @public
 */
export interface DeviceRegistrySettings {
    password?: string;
    username?: string;
    packagePort?: number;
    ecpPort?: number;
    timeout?: number;
}

/**
 * A device entry in the devices registry.
 * Contains device addressing info plus optional per-device settings.
 * @public
 */
export interface DeviceRegistryEntry extends DeviceRegistrySettings {
    // One of these identifies the device
    host?: string;
    esn?: string;
    /** The RCE device's numeric management-api id */
    id?: number;
    instanceUrl?: string;

    // Optional RCE token (can be injected at runtime)
    rceToken?: string;
}

/**
 * Options that can be passed to the RokuDeploy constructor to set defaults
 * that will be merged into every method call.
 * @public
 */
export interface RokuDeployConstructorOptions {
    /**
     * A custom logger instance. If not provided, the global logger will be used.
     */
    logger?: Logger;
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
     * The password for logging in to the developer portal on the target Roku device
     */
    password?: string;
    /**
     * The username for the roku box. This will always be 'rokudev', but allows to be overridden
     * just in case roku adds support for custom usernames in the future
     * @default 'rokudev'
     */
    username?: string;
    /**
     * The port that should be used when installing the package. Defaults to 80.
     */
    packagePort?: number;
    /**
     * The port used to send remote control commands (like home press, back, etc.). Defaults to 8060.
     */
    ecpPort?: number;
    /**
     * The default RCE bearer token for Roku Cloud Emulator devices whose config carries no
     * rceToken of its own. A config-supplied rceToken always wins over this default.
     */
    rceToken?: string;
}

/**
 * The shape of a `rokudeploy.json` file, as returned by `rokuDeploy.loadConfigFile()`: one flat set of
 * values that each CLI command reads as it needs them. CLI args override the file, and the file
 * overrides the library's built-in defaults. Relative paths are relative to the json file itself.
 *
 * Also accepts the keys of a v3 rokudeploy.json (marked `@deprecated`) so an old file still loads;
 * each CLI command maps the ones that have a v4 equivalent.
 * @public
 */
export interface RokuDeployOptions {
    /**
     * The target device. Can be a `devices` registry name or an inline device config.
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
     * @default 'rokudev'
     */
    username?: string;

    /**
     * The password for logging in to the developer portal on the target Roku device
     */
    password?: string;

    /**
     * The port that should be used when installing the package. Defaults to 80.
     * This is mainly useful for things like emulators that use alternate ports,
     * or when publishing through some type of port forwarding configuration.
     */
    packagePort?: number;

    /**
     * The port used to send remote control commands (like home press, back, etc.). Defaults to 8060.
     * This is mainly useful for things like emulators that use alternate ports,
     * or when sending commands through some type of port forwarding.
     */
    ecpPort?: number;

    /**
     * The default RCE bearer token for Roku Cloud Emulator devices whose config carries no
     * rceToken of its own
     */
    rceToken?: string;

    /**
     * The timeout for each network request to the device, in milliseconds (not for the overall
     * roku-deploy call). Defaults to 150000 (2 minutes 30 seconds).
     */
    timeout?: number;

    /**
     * The log level
     * @default 'log'
     */
    logLevel?: LogLevel | LogLevelNumeric;

    /**
     * The folder holding the project source; the manifest lives directly under it. Read by `stage`.
     * @default './'
     */
    rootDir?: string;

    /**
     * Globs (relative to `rootDir`), or `{ src, dest }` entries, selecting the files to include when
     * staging. Read by `stage`. The `zip` command takes its own `--files` instead.
     * @default [
            'source/**\/*.*',
            'components/**\/*.*',
            'images/**\/*.*',
            'locale/**\/*.*',
            'manifest'
        ],
     */
    files?: FileEntry[];

    /**
     * Where the filtered copy of `rootDir` is written by `stage`, and the folder `zip` zips.
     * @default './out/.roku-deploy-staging'
     */
    stagingDir?: string;

    /**
     * The base name of generated files: `zip` writes `<outFile>.zip`, `package` writes `<outFile>.pkg`,
     * inside `./out`. An explicit extension is honored as given.
     */
    outFile?: string;

    /**
     * What type of app is being sideloaded? `'channel'` is for applications, and `'dcl'` is for installing component libraries on device for use in channels.
     * @default 'channel'
     */
    appType?: 'channel' | 'dcl';

    /**
     * If true, the sideload will fail on compile error
     * @default true
     */
    failOnCompileError?: boolean;

    /**
     * If true, the previously installed dev channel will be deleted before installing the new one
     * @default true
     */
    deleteDevChannel?: boolean;

    /**
     * Overrides for values used during the zip upload process. You probably don't need to change these...
     */
    packageUploadOverrides?: {
        /**
         * The route to use for uploading to the Roku device. Defaults to 'plugin_install'
         * @default 'plugin_install'
         */
        route?: string;

        /**
         * A dictionary of form fields to be included in the package upload request. Set a value to null to delete from the form
         */
        formData?: Record<string, any>;
    };

    /**
     * Convert the installed channel to squashfs before packaging. Read by `package`. On by default;
     * set to false to skip.
     */
    convertToSquashfs?: boolean;

    /**
     * The signing password of the key currently on the device. Read by `package` and `rekey`.
     */
    signingPassword?: string;

    /**
     * A previously signed `.pkg` whose key should be installed on the device. Read by `rekey`, and by
     * `sideload`/`package` with `--rekey`. The cli equivalent is `--pkg`.
     */
    rekeySignedPackage?: string;

    /**
     * Dev ID we are expecting the device to have. If supplied we check that the dev ID returned after keying matches what we expected
     */
    devId?: string;

    /**
     * The directory where screenshots should be saved. Will use the OS temp directory by default
     */
    screenshotDir?: string;

    //
    // v3 keys. Kept so a v3 rokudeploy.json still loads; the CLI commands map the ones that have a
    // v4 equivalent onto it.
    //

    /**
     * Path to a bsconfig.json project file
     * @deprecated v3 key with no v4 equivalent; ignored.
     */
    project?: string;

    /**
     * The folder where the zip/pkg package should be placed
     * @default './out'
     * @deprecated combined with `outFile` by the CLI; use `--out` on `zip`/`package` instead.
     */
    outDir?: string;

    /**
     * Set this to true to prevent the staging folder from being deleted after creating the package
     * @deprecated v3 key with no v4 equivalent (v4 never deletes the staging folder); ignored.
     */
    retainStagingFolder?: boolean;

    /**
     * Set this to true to prevent the staging folder from being deleted after creating the package
     * @deprecated v3 key with no v4 equivalent (v4 never deletes the staging folder); ignored.
     */
    retainStagingDir?: boolean;

    /**
     * Should the zipped package be retained after deploying to a roku. If false, this will delete the zip after a deployment.
     * @deprecated v3 key with no v4 equivalent; ignored.
     */
    retainDeploymentArchive?: boolean;

    /**
     * The path where roku-deploy should stage all of the files right before being zipped
     * @deprecated use `stagingDir`, which wins when both are set.
     */
    stagingFolderPath?: string;

    /**
     * The IP address or hostname of the target Roku device.
     * @example '192.168.1.21'
     * @deprecated use `device: { host }`, which wins when both are set.
     */
    host?: string;

    /**
     * Enable the socket based BrightScript debug protocol for the sideloaded channel.
     * @deprecated a per-session debugger switch, not project config; ignored in rokudeploy.json. Pass `--remoteDebug` instead.
     */
    remoteDebug?: boolean;

    /**
     * Tell the device a debugger will attach early to consume compile errors (requires `remoteDebug`).
     * @deprecated a per-session debugger switch, not project config; ignored in rokudeploy.json. Pass `--remoteDebugConnectEarly` instead.
     */
    remoteDebugConnectEarly?: boolean;

    /**
     * When publishing a sideloaded channel, set this to `false` to prevent the Roku device from auto-launching the channel after install.
     * @deprecated v3 key with no v4 equivalent; ignored.
     */
    autoLaunch?: boolean;

    /**
     * The port used to send remote control commands (like home press, back, etc.). Defaults to 8060.
     * @deprecated use `ecpPort`, which wins when both are set.
     */
    remotePort?: number;

    /**
     * If true we increment the build number to be a timestamp in the format yymmddHHMM
     * @deprecated v3 key with no v4 equivalent; ignored.
     */
    incrementBuildNumber?: boolean;

    /**
     * If true, the previously installed dev channel will be deleted before installing the new one
     * @deprecated use `deleteDevChannel`, which wins when both are set.
     */
    deleteInstalledChannel?: boolean;
}

/**
 * @public
 */
export type FileEntry = (string | { src: string[] | string; dest?: string });
