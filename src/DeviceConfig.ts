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
 * Configuration for an RCE device addressed by device ID
 */
export interface RceDeviceConfigById {
    id: string;
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
 * Check if a device config is for a local network device
 */
export function isLocalDeviceConfig(config: DeviceConfig): config is LocalDeviceConfig {
    return 'host' in config;
}

/**
 * Check if a device config is for an RCE device
 */
export function isRceDeviceConfig(config: DeviceConfig): config is RceDeviceConfig {
    return 'esn' in config || 'id' in config || 'instanceUrl' in config;
}

/**
 * Check if an RCE config is addressed by ESN
 */
export function isRceByEsn(config: RceDeviceConfig): config is RceDeviceConfigByEsn {
    return 'esn' in config;
}

/**
 * Check if an RCE config is addressed by device ID
 */
export function isRceById(config: RceDeviceConfig): config is RceDeviceConfigById {
    return 'id' in config;
}

/**
 * Check if an RCE config is addressed by instance URL
 */
export function isRceByUrl(config: RceDeviceConfig): config is RceDeviceConfigByUrl {
    return 'instanceUrl' in config;
}
