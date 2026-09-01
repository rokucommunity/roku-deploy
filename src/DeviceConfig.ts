import { InvalidOptionError } from './Errors';

// === Local Device ===

/**
 * Configuration for a local network device (IP, hostname, domain, or *.local)
 */
export interface LocalDeviceConfig {
    host: string;
}

// === RCE Device Variants ===

/**
 * Configuration for an RCE device addressed by ESN
 */
export interface RceDeviceConfigByEsn {
    esn: string;
    rceToken?: string;
}

/**
 * Configuration for an RCE device addressed by device ID (the numeric id the management api
 * assigns, as seen in `DeviceOut.id`)
 */
export interface RceDeviceConfigById {
    id: number;
    rceToken?: string;
}

/**
 * Configuration for an RCE device addressed by instance URL
 */
export interface RceDeviceConfigByUrl {
    instanceUrl: string;
    rceToken?: string;
}

/**
 * Configuration for any RCE (Roku Cloud Emulator) device
 */
export type RceDeviceConfig =
    | RceDeviceConfigByEsn
    | RceDeviceConfigById
    | RceDeviceConfigByUrl;

/**
 * Configuration specifying how to connect to a device.
 * Either a local network device or an RCE device.
 */
export type DeviceConfig = LocalDeviceConfig | RceDeviceConfig;

/**
 * What the user provides as a device option.
 * Either a registry name (string) or an inline device config.
 */
export type DeviceOption = string | DeviceConfig;

// === Type Guards ===

/**
 * Any object that may carry device identifier keys (a DeviceConfig, a registry entry, etc.)
 * Lets the guards below work on partially-populated shapes, not just the strict union.
 */
export type DeviceConfigLike = Partial<LocalDeviceConfig & RceDeviceConfigByEsn & RceDeviceConfigById & RceDeviceConfigByUrl>;

/**
 * Check if a device config is for a local network device (has a non-empty host)
 */
export function isLocalDeviceConfig(config: DeviceConfigLike): config is LocalDeviceConfig {
    return !!config.host;
}

/**
 * Check if a device config is for an RCE device
 */
export function isRceDeviceConfig(config: DeviceConfigLike): config is RceDeviceConfig {
    return isRceDeviceConfigByEsn(config) || isRceDeviceConfigById(config) || isRceDeviceConfigByUrl(config);
}

/**
 * Check if an RCE config is addressed by ESN (has a non-empty esn)
 * @internal
 */
export function isRceDeviceConfigByEsn(config: DeviceConfigLike): config is RceDeviceConfigByEsn {
    return !!config.esn;
}

/**
 * Check if an RCE config is addressed by device ID.
 * An explicit !== undefined check (unlike the truthy string checks): 0 is a valid id
 * @internal
*/
export function isRceDeviceConfigById(config: DeviceConfigLike): config is RceDeviceConfigById {
    return config.id !== undefined;
}

/**
 * Check if an RCE config is addressed by instance URL (has a non-empty instanceUrl)
 * @internal
 */
export function isRceDeviceConfigByUrl(config: DeviceConfigLike): config is RceDeviceConfigByUrl {
    return !!config.instanceUrl;
}

/**
 * Validate that a device config carries exactly one targeting identifier (host, esn, id, or instanceUrl).
 * Throws an InvalidOptionError if zero or more than one are present; otherwise asserts config is a DeviceConfig.
 * @param subject prefixes the error message, so callers with more context (e.g. a named registry entry) can identify what failed
 */
export function validateDeviceConfig(config: DeviceConfigLike, subject = 'Device config'): asserts config is DeviceConfig {
    const presentNames: string[] = [];
    if (config.host) {
        presentNames.push('host');
    }
    if (config.esn) {
        presentNames.push('esn');
    }
    if (config.id !== undefined) {
        presentNames.push('id');
    }
    if (config.instanceUrl) {
        presentNames.push('instanceUrl');
    }

    if (presentNames.length === 0) {
        throw new InvalidOptionError(`${subject} must specify exactly one targeting identifier: host, esn, id, or instanceUrl`, { optionName: 'device' });
    }
    if (presentNames.length > 1) {
        throw new InvalidOptionError(`${subject} specifies multiple targeting identifiers (${presentNames.join(', ')}); exactly one of host, esn, id, or instanceUrl is allowed`, { optionName: 'device' });
    }
}
