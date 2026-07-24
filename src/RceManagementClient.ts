/* eslint-disable camelcase */
import * as needle from 'needle';

/**
 * Default base URL for the Roku Cloud Emulator (RCE) management API. This is the core management
 * surface (device inventory, lifecycle, snapshots, firmware, usage) and is distinct from a running
 * device's own instance API. It is authenticated with an RCE bearer token.
 */
export const defaultRceManagementBaseUrl = 'https://api.rce.roku.com/api/v1';

/**
 * Client for the Roku Cloud Emulator management API. All calls send the bearer token and return the
 * parsed JSON response.
 */
export class RceManagementClient {
    constructor(options: RceManagementClientOptions) {
        this.token = options.token;
        this.baseUrl = (options.baseUrl ?? defaultRceManagementBaseUrl).replace(/\/+$/, '');
        this.timeout = options.timeout ?? 30000;
    }

    private readonly token: string;

    private readonly baseUrl: string;

    private readonly timeout: number;

    /**
     * Get the authenticated user and their organisation (device/snapshot limits, current counts).
     */
    public getUserInfo(): Promise<UserOut> {
        return this.send('get', '/user/me');
    }

    /**
     * List the firmware versions available for creating and starting devices.
     */
    public listFirmwareVersions(): Promise<FirmwareVersionOut[]> {
        return this.send('get', '/firmwareVersions');
    }

    /**
     * List the caller's devices.
     */
    public listDevices(options: ListDevicesOptions = {}): Promise<DeviceOut[]> {
        return this.send('get', '/devices', { query: { items: options.items, page: options.page } });
    }

    /**
     * Get a single device by id.
     */
    public getDevice(deviceId: DeviceId): Promise<DeviceOut> {
        return this.send('get', `/devices/${deviceId}`);
    }

    /**
     * Create a new device.
     */
    public createDevice(device: DeviceCreate): Promise<DeviceOut> {
        return this.send('post', '/devices', { body: device });
    }

    /**
     * Update a device's mutable fields (name, account name, note, properties).
     */
    public updateDevice(deviceId: DeviceId, update: DeviceUpdate): Promise<DeviceOut> {
        return this.send('patch', `/devices/${deviceId}`, { body: update });
    }

    /**
     * Boot a device from a snapshot. Resolves with the device, whose running_device block carries
     * the instance API URL and video (Janus) connection details.
     */
    public startDevice(deviceId: DeviceId, start: DeviceStart): Promise<DeviceOut> {
        return this.send('post', `/devices/${deviceId}/start`, { body: start });
    }

    /**
     * Shut down a running device.
     */
    public stopDevice(deviceId: DeviceId): Promise<DeviceOut> {
        return this.send('post', `/devices/${deviceId}/stop`);
    }

    /**
     * Get a device's run history.
     */
    public getDeviceRuns(deviceId: DeviceId): Promise<DeviceRun[]> {
        return this.send('get', `/devices/${deviceId}/runs`);
    }

    /**
     * Read the logs captured for a specific instance run of a device.
     */
    public readLogs(deviceId: DeviceId, instanceId: number): Promise<string> {
        return this.send('get', `/devices/${deviceId}/logs/${instanceId}`);
    }

    public listSnapshots(deviceId: DeviceId): Promise<SnapshotOut[]> {
        return this.send('get', `/devices/${deviceId}/snapshots`);
    }

    public createSnapshot(deviceId: DeviceId, snapshot: SnapshotCreate): Promise<SnapshotOut> {
        return this.send('post', `/devices/${deviceId}/snapshots`, { body: snapshot });
    }

    public getSnapshot(deviceId: DeviceId, snapshotId: number): Promise<SnapshotOut> {
        return this.send('get', `/devices/${deviceId}/snapshots/${snapshotId}`);
    }

    public updateSnapshot(deviceId: DeviceId, snapshotId: number, update: SnapshotUpdate): Promise<SnapshotOut> {
        return this.send('patch', `/devices/${deviceId}/snapshots/${snapshotId}`, { body: update });
    }

    public deleteSnapshot(deviceId: DeviceId, snapshotId: number): Promise<void> {
        return this.send('delete', `/devices/${deviceId}/snapshots/${snapshotId}`);
    }

    /**
     * Find a device by its serial number (ESN), or undefined when the caller has no such device.
     */
    public async findDeviceByEsn(esn: string): Promise<DeviceOut | undefined> {
        const devices = await this.listDevices();
        return devices.find((device) => device.serial_number === esn);
    }

    /**
     * Resolve the live instance API URL for a running device, throwing when the device is not running.
     * This is the base URL a caller uses to talk ECP and logs directly to the instance.
     */
    public async getRunningInstanceApiUrl(deviceId: DeviceId): Promise<string> {
        const device = await this.getDevice(deviceId);
        const url = device.running_device?.instance_api_url;
        if (!url) {
            throw new Error(`Device ${deviceId} is not running (status '${device.status}'); start it before connecting to its instance`);
        }
        return url;
    }

    /**
     * Single choke point for HTTP so auth and error handling stay consistent, and so tests can stub
     * one method rather than the network.
     */
    protected send<TResponse>(method: HttpMethod, path: string, options: SendOptions = {}): Promise<TResponse> {
        const url = this.baseUrl + path + this.buildQueryString(options.query);
        const needleOptions: needle.NeedleOptions = {
            json: true,
            timeout: this.timeout,
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: 'application/json'
            }
        };
        return new Promise<TResponse>((resolve, reject) => {
            needle.request(method, url, options.body ?? null, needleOptions, (error, response) => {
                if (error) {
                    reject(error);
                    return;
                }
                const statusCode = response.statusCode ?? 0;
                if (statusCode < 200 || statusCode >= 300) {
                    reject(new Error(`RCE management ${method.toUpperCase()} ${path} failed (status ${statusCode})`));
                    return;
                }
                resolve(response.body as TResponse);
            });
        });
    }

    private buildQueryString(query?: Record<string, string | number | undefined>): string {
        if (!query) {
            return '';
        }
        const parts = Object.entries(query)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        return parts.length > 0 ? `?${parts.join('&')}` : '';
    }
}

export interface RceManagementClientOptions {
    /**
     * RCE bearer token (the same token used for a device's instance API).
     */
    token: string;
    /**
     * Override the management API base URL. Defaults to the public api.rce.roku.com surface.
     */
    baseUrl?: string;
    /**
     * Per-request timeout in milliseconds. Defaults to 30000.
     */
    timeout?: number;
}

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

export type DeviceId = number | string;

export interface ListDevicesOptions {
    items?: number;
    page?: number;
}

interface SendOptions {
    query?: Record<string, string | number | undefined>;
    body?: unknown;
}

export type DeviceType = 'tv' | 'stb' | 'streambar';

export type CreatableDeviceType = 'tv' | 'stb';

export type DeviceStatus = 'shutdown' | 'pending' | 'running';

export type DeviceInstanceStatus = 'created' | 'pending' | 'running' | 'completed' | 'failed' | 'crashed' | 'unknown';

export interface IceServer {
    urls: string[];
    username?: string | null;
    credential?: string | null;
}

export interface DeviceInstanceInfo {
    id: number;
    creator_id: string;
    created_at: string;
    started_at?: string | null;
    snapshot_id: number;
    snapshot_name?: string;
    janus_id?: number | null;
    janus_pin?: string | null;
    janus_token?: string | null;
    janus_websocket_url?: string | null;
    janus_ice_servers?: IceServer[] | null;
    instance_api_url?: string | null;
    instance_uuid: string;
    firmware_version_id: string;
    max_runtime: number;
}

export interface DeviceOut {
    id: number;
    device_type: DeviceType;
    name: string;
    account_name?: string | null;
    last_snapshot_name?: string | null;
    snapshots?: number[];
    status?: DeviceStatus;
    created_at: string;
    note?: string | null;
    serial_number?: string | null;
    properties?: Record<string, any> | null;
    last_snapshot_id?: number | null;
    firmware_version_id?: string | null;
    running_device?: DeviceInstanceInfo | null;
}

export interface DeviceCreate {
    name: string;
    device_type: CreatableDeviceType;
    account_name?: string | null;
    note?: string | null;
    properties?: Record<string, any> | null;
}

export interface DeviceStart {
    snapshot_id: number;
    firmware_version_id: string;
    max_runtime: number;
}

export interface DeviceUpdate {
    name?: string;
    account_name?: string | null;
    note?: string | null;
    properties?: Record<string, any> | null;
}

export interface DeviceRun {
    id: number;
    /**
     * ID of the device instance.
     */
    instance_id?: number;
    /**
     * The ID of the user who started the device.
     */
    creator_id?: string;
    /**
     * The username of the user who started the device.
     */
    creator_username?: string;
    snapshot_id?: number;
    snapshot_name?: string;
    status?: DeviceInstanceStatus;
    created_at?: string;
    started_at?: string | null;
    ended_at?: string | null;
    /**
     * Runtime of the device instance, in seconds.
     */
    runtime?: number;
    firmware_version_id?: string | null;
    /**
     * The maximum runtime allowed for the device instance, in seconds.
     */
    max_runtime?: number;
    [key: string]: unknown;
}

export interface SnapshotOut {
    id: number;
    created_at: string;
    parent_id?: number | null;
    name?: string;
    firmware_version_display_name?: string | null;
    started_at?: string | null;
    children?: number[];
    ready?: boolean;
    live: boolean;
    base: boolean;
    note?: string | null;
    properties?: Record<string, any> | null;
    firmware_version_id?: string | null;
}

export interface SnapshotCreate {
    name: string;
    parent_id?: number | null;
    note?: string | null;
    properties?: Record<string, any> | null;
}

export interface SnapshotUpdate {
    name?: string;
    note?: string | null;
    properties?: Record<string, any> | null;
}

export interface FirmwareVersionOut {
    firmware_version_id: string;
    device_type: DeviceType;
    display_name?: string | null;
}

export interface UserOrganisationOut {
    id: number;
    idp_id: string;
    name: string;
    max_devices: number;
    max_snapshots: number;
    max_project_runtime: number;
    current_devices: Record<string, number>;
}

export interface UserOut {
    id: string;
    username: string;
    full_name?: string | null;
    email?: string | null;
    organisation: UserOrganisationOut;
}
