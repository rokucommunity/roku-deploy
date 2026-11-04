import type { Logger } from '@rokucommunity/logger';
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
 * @public
 */
export type FileEntry = (string | { src: string[] | string; dest?: string });
