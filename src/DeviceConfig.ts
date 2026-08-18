// === Local Device ===

/**
 * Configuration for a local network device (IP, hostname, domain, or *.local)
 * @public
 */
export interface LocalDeviceConfig {
    host: string;
}

// === RCE Device Variants ===

/**
 * Configuration for an RCE device addressed by ESN
 * @public
 */
export interface RceDeviceConfigByEsn {
    esn: string;
    rceToken?: string;
}

/**
 * Configuration for an RCE device addressed by device ID (the numeric id the management api
 * assigns, as seen in `DeviceOut.id`)
 * @public
 */
export interface RceDeviceConfigById {
    id: number;
    rceToken?: string;
}

/**
 * Configuration for an RCE device addressed by instance URL
 * @public
 */
export interface RceDeviceConfigByUrl {
    instanceUrl: string;
    rceToken?: string;
}

/**
 * Configuration for any RCE (Roku Cloud Emulator) device
 * @public
 */
export type RceDeviceConfig =
    | RceDeviceConfigByEsn
    | RceDeviceConfigById
    | RceDeviceConfigByUrl;

/**
 * Configuration specifying how to connect to a device.
 * Either a local network device or an RCE device.
 * @public
 */
export type DeviceConfig = LocalDeviceConfig | RceDeviceConfig;

/**
 * What the user provides as a device option.
 * Either a registry name (string) or an inline device config.
 * @public
 */
export type DeviceOption = string | DeviceConfig;

// === Type Guards ===

/**
 * Any object that may carry device identifier keys (a DeviceConfig, a registry entry, etc.)
 * Lets the guards below work on partially-populated shapes, not just the strict union.
 * @public
 */
export type DeviceConfigLike = Partial<LocalDeviceConfig & RceDeviceConfigByEsn & RceDeviceConfigById & RceDeviceConfigByUrl>;

/**
 * Check if a device config is for a local network device (has a non-empty host)
 * @public
 */
export function isLocalDeviceConfig(config: DeviceConfigLike): config is LocalDeviceConfig {
    return !!config.host;
}

/**
 * Check if a device config is for an RCE device
 * @public
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
