import type { LogLevel, LogLevelNumeric } from '@rokucommunity/logger';
import type { DeviceOption } from './DeviceConfig';
import type { FileEntry } from './RokuDeployOptions';

/**
 * The shape of a `rokudeploy.json` config file: one flat set of values that commands read as they
 * need them. A comment in the sample names the commands each value feeds. CLI args override the
 * file, and the file overrides the built-in defaults.
 * @public
 */
export interface RokuDeployConfig {
    /**
     * The target device, as an inline device config.
     * @example { host: '192.168.1.21', password: 'aaaa' }
     */
    device?: DeviceOption;
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
     * The working directory used to resolve relative paths
     */
    cwd?: string;
    /**
     * The log level
     */
    logLevel?: LogLevel | LogLevelNumeric;
    /**
     * The folder holding the project source; the manifest lives directly under it. Read by `stage`,
     * and by `sideload`/`package` when they stage first.
     */
    rootDir?: string;
    /**
     * Globs (relative to `rootDir`), or `{ src, dest }` entries, selecting the files to include when
     * staging. Read by `stage`, and by `sideload`/`package` when they stage first. The `zip` command
     * takes its own files array instead.
     */
    files?: FileEntry[];
    /**
     * Where the filtered copy of `rootDir` is written before zipping.
     */
    stagingDir?: string;
    /**
     * The base name of generated files: `zip` writes `<outFile>.zip`, `package` writes `<outFile>.pkg`.
     * An explicit extension is honored as given.
     */
    outFile?: string;
    /**
     * Convert the installed channel to squashfs before packaging. Read by `package`.
     */
    convertToSquashfs?: boolean;
    /**
     * The signing password of the key currently on the device. Read by `package` and `rekey`.
     */
    signingPassword?: string;
    /**
     * A previously signed `.pkg` whose key should be installed on the device. Read by `rekey`.
     */
    rekeySignedPackage?: string;
}
