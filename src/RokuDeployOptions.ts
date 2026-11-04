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
 * The shape of a `rokudeploy.json` file, as returned by `rokuDeploy.loadConfigFile()`. Relative paths
 * are relative to the json file itself. The `@deprecated` keys are v3 keys, kept so an old file still loads.
 * @public
 */
export interface RokuDeployOptions {
    /**
     * The root path to the folder holding your Roku project's source files (manifest, components/, source/ should be directly under this folder)
     * @default './'
     */
    rootDir?: string;

    /**
      * What type of app is being sideloaded? `'channel'` is for applications, and `'dcl'` is for installing component libraries on device for use in channels.
      * @default 'channel'
     */
    appType?: 'channel' | 'dcl';

    /**
     * An array of source file paths, source file globs, or {src,dest} objects indicating
     * where the source files are and where they should be placed
     * in the output directory
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
     * The port that should be used when installing the package. Defaults to 80.
     * This is mainly useful for things like emulators that use alternate ports,
     * or when publishing through some type of port forwarding configuration.
     */
    packagePort?: number;

    /**
     * When publishing a side loaded channel this flag can be used to enable the socket based BrightScript debug protocol. Defaults to false.
     * More information on the BrightScript debug protocol can be found here: https://developer.roku.com/en-ca/docs/developer-program/debugging/socket-based-debugger.md
     * @deprecated a per-session debugger switch, not project config; ignored in rokudeploy.json. Pass `--remoteDebug` instead.
     */
    remoteDebug?: boolean;

    /**
     * When publishing a sideloaded channel, this flag can be used to tell the Roku device that, should any compile errors occur, a client device (such as vscode)
     * will be trying to attach to the debug protocol control port to consume those compile errors. This must be used in conjuction with the `remoteDebug` option
     * @deprecated a per-session debugger switch, not project config; ignored in rokudeploy.json. Pass `--remoteDebugConnectEarly` instead.
     */
    remoteDebugConnectEarly?: boolean;

    /**
     * The port used to send remote control commands (like home press, back, etc.). Defaults to 8060.
     * This is mainly useful for things like emulators that use alternate ports,
     * or when sending commands through some type of port forwarding.
     */
    ecpPort?: number;

    /**
     * The directory where screenshots should be saved. Will use the OS temp directory by default
     */
    screenshotDir?: string;

    /**
     * The timeout for each network request to the device, in milliseconds (not for the overall
     * roku-deploy call). Defaults to 150000 (2 minutes 30 seconds).
     */
    timeout?: number;

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
     * The password used for creating signed packages
     */
    signingPassword?: string;

    /**
     * Dev ID we are expecting the device to have. If supplied we check that the dev ID returned after keying matches what we expected
     */
    devId?: string;

    /**
     * If true, the publish will fail on compile error
     */
    failOnCompileError?: boolean;

    /**
     * The log level applied to the logger.
     * @default 'log'
     */
    logLevel?: LogLevel | LogLevelNumeric;

    /**
     * If true, the previously installed dev channel will be deleted before installing the new one
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
     * The default RCE bearer token for Roku Cloud Emulator devices whose config carries no
     * rceToken of its own
     */
    rceToken?: string;

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
     * Convert the installed channel to squashfs before packaging. Read by `package`. On by default;
     * set to false to skip.
     */
    convertToSquashfs?: boolean;

    /**
     * Path to a copy of the signed package you want to use for rekeying. The cli equivalent is `--pkg`.
     */
    rekeySignedPackage?: string;

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
