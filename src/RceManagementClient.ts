/* eslint-disable camelcase */
import * as needle from 'needle';
import type { RceDeviceConfig } from './DeviceConfig';
import { isRceDeviceConfigById, isRceDeviceConfigByUrl } from './DeviceConfig';

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
    public getUserInfo(options?: GetUserInfoOptions): Promise<User> {
        return this.send('get', '/user/me', { token: options?.token });
    }

    /**
     * List the firmware versions available for creating and starting devices.
     */
    public listFirmwareVersions(options?: ListFirmwareVersionsOptions): Promise<FirmwareVersion[]> {
        return this.send('get', '/firmwareVersions', { query: { items: options?.items, page: options?.page }, token: options?.token });
    }

    /**
     * List the caller's devices.
     */
    public listDevices(options?: ListDevicesOptions): Promise<RceDevice[]> {
        return this.send('get', '/devices', { query: { items: options?.items, page: options?.page }, token: options?.token });
    }

    /**
     * Get a single device by id.
     */
    public getDevice(options: GetDeviceOptions): Promise<RceDevice> {
        return this.send('get', `/devices/${options.deviceId}`, { token: options.token });
    }

    /**
     * Create a new device.
     */
    public createDevice(options: CreateDeviceOptions): Promise<RceDevice> {
        return this.send('post', '/devices', { body: options.device, token: options.token });
    }

    /**
     * Update a device's mutable fields (name, account name, note, properties).
     */
    public updateDevice(options: UpdateDeviceOptions): Promise<RceDevice> {
        return this.send('patch', `/devices/${options.deviceId}`, { body: options.update, token: options.token });
    }

    /**
     * Boot a device from a snapshot. Resolves with the device, whose running_device block carries
     * the instance API URL and video (Janus) connection details.
     */
    public startDevice(options: StartDeviceOptions): Promise<RceDevice> {
        return this.send('post', `/devices/${options.deviceId}/start`, { body: options.start, token: options.token });
    }

    /**
     * Shut down a running device.
     */
    public stopDevice(options: StopDeviceOptions): Promise<RceDevice> {
        return this.send('post', `/devices/${options.deviceId}/stop`, { token: options.token });
    }

    /**
     * Get a device's run history.
     */
    public getDeviceRuns(options: GetDeviceRunsOptions): Promise<DeviceRun[]> {
        return this.send('get', `/devices/${options.deviceId}/runs`, { token: options.token });
    }

    /**
     * Read the logs captured for a specific instance run of a device.
     */
    public readLogs(options: ReadLogsOptions): Promise<string> {
        return this.send('get', `/devices/${options.deviceId}/logs/${options.instanceId}`, { token: options.token });
    }

    public listSnapshots(options: ListSnapshotsOptions): Promise<Snapshot[]> {
        return this.send('get', `/devices/${options.deviceId}/snapshots`, { query: { items: options.items, page: options.page }, token: options.token });
    }

    public createSnapshot(options: CreateSnapshotOptions): Promise<Snapshot> {
        return this.send('post', `/devices/${options.deviceId}/snapshots`, { body: options.snapshot, token: options.token });
    }

    public getSnapshot(options: GetSnapshotOptions): Promise<Snapshot> {
        return this.send('get', `/devices/${options.deviceId}/snapshots/${options.snapshotId}`, { token: options.token });
    }

    public updateSnapshot(options: UpdateSnapshotOptions): Promise<Snapshot> {
        return this.send('patch', `/devices/${options.deviceId}/snapshots/${options.snapshotId}`, { body: options.update, token: options.token });
    }

    public deleteSnapshot(options: DeleteSnapshotOptions): Promise<void> {
        return this.send('delete', `/devices/${options.deviceId}/snapshots/${options.snapshotId}`, { token: options.token });
    }

    /**
     * Find a device by its serial number (ESN), or undefined when the caller has no such device.
     */
    public async findDeviceByEsn(options: FindDeviceByEsnOptions): Promise<RceDevice | undefined> {
        //the devices endpoint is paginated and defaults to 100 items per page, which would silently
        //hide a device past the first page; `items: 0` is the api's documented "no limit" value, and
        //the response is a plain array (no total-count envelope), so this is also the only way to
        //know the whole inventory was searched
        const devices = await this.listDevices({ items: 0, token: options.token });
        return devices.find((device) => device.serial_number === options.esn);
    }

    /**
     * Resolve an RCE device config to its live instance API URL (trailing slashes stripped). An
     * instanceUrl-addressed config is returned directly; an id- or esn-addressed config is resolved
     * through the management api and must be running.
     */
    public async getInstanceUrl(options: GetInstanceUrlOptions): Promise<string> {
        const config = options.device;
        let instanceUrl: string;
        if (isRceDeviceConfigByUrl(config)) {
            instanceUrl = config.instanceUrl;
        } else if (isRceDeviceConfigById(config)) {
            instanceUrl = await this.getRunningInstanceApiUrl({ deviceId: this.parseDeviceId(config.id), token: options.token });
        } else {
            const device = await this.findDeviceByEsn({ esn: config.esn, token: options.token });
            if (!device) {
                throw new Error(`No RCE device found with esn '${config.esn}'`);
            }
            instanceUrl = await this.getRunningInstanceApiUrl({ deviceId: device.id, token: options.token });
        }
        return instanceUrl.replace(/\/+$/, '');
    }

    /**
     * Normalize a device config's id to the numeric device id the management api uses. The type
     * says number, but device configs also arrive from untyped sources (a json launch config, a
     * javascript caller), so a numeric string is coerced and anything else throws a clear error
     * instead of turning into a request to `/devices/NaN` and a baffling server-side error.
     */
    private parseDeviceId(id: number | string): number {
        if (typeof id === 'number' && Number.isInteger(id)) {
            return id;
        }
        if (typeof id === 'string' && /^\d+$/.test(id)) {
            return Number(id);
        }
        throw new Error(`Invalid RCE device id '${id}': expected a numeric id`);
    }

    /**
     * Resolve the live instance API URL for a running device, throwing when the device is not running.
     * This is the base URL a caller uses to talk ECP and logs directly to the instance.
     */
    public async getRunningInstanceApiUrl(options: GetRunningInstanceApiUrlOptions): Promise<string> {
        const device = await this.getDevice({ deviceId: options.deviceId, token: options.token });
        const url = device.running_device?.instance_api_url;
        if (!url) {
            throw new Error(`Device ${options.deviceId} is not running (status '${device.status}'); start it before connecting to its instance`);
        }
        return url;
    }

    /**
     * Single choke point for HTTP so auth and error handling stay consistent, and so tests can stub
     * one method rather than the network. A per-call token wins over the constructor token.
     */
    protected send<TResponse>(method: HttpMethod, path: string, options?: SendOptions): Promise<TResponse> {
        const url = this.baseUrl + path + this.buildQueryString(options?.query);
        const needleOptions: needle.NeedleOptions = {
            json: true,
            //needle's `timeout` alias only bounds connection establishment; a server that accepts
            //the connection but never responds would hang the request forever. Map the timeout to
            //both the connection and first-response-byte timers, the same way request.ts does (and
            //like there, deliberately do NOT set `read_timeout` - see request.ts for the hazards
            //of needle's read timer)
            open_timeout: this.timeout,
            response_timeout: this.timeout,
            //needle's default (Node's global pooling agent, no `Connection: close`) leaves a
            //keep-alive socket open after the response, which keeps the Node event loop alive so a
            //CLI process that only talked to the management api never exits - see request.ts for
            //the full story. A fresh un-pooled socket per request costs a TLS handshake, which is
            //fine for this low-volume api.
            connection: 'close',
            agent: false,
            headers: {
                Authorization: `Bearer ${options?.token ?? this.token}`,
                Accept: 'application/json'
            }
        };
        return new Promise<TResponse>((resolve, reject) => {
            needle.request(method, url, options?.body ?? null, needleOptions, (error, response) => {
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

export type DeviceId = number;

/**
 * Options accepted by every RceManagementClient call.
 */
export interface RceManagementRequestOptions {
    /**
     * RCE bearer token to use for this call, overriding the client's constructor token.
     */
    token?: string;
}

/**
 * Paging options accepted by the paginated list endpoints (devices, firmware versions, snapshots).
 */
export interface RceManagementPagingOptions {
    /**
     * The number of items per page. The api defaults to 100 when omitted; `0` means no limit
     * (return everything in one response).
     */
    items?: number;
    /**
     * The zero-based page number. Defaults to `0` (the first page).
     */
    page?: number;
}

export type GetUserInfoOptions = RceManagementRequestOptions;

export type ListFirmwareVersionsOptions = RceManagementRequestOptions & RceManagementPagingOptions;

export type ListDevicesOptions = RceManagementRequestOptions & RceManagementPagingOptions;

export interface GetDeviceOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
}

export interface CreateDeviceOptions extends RceManagementRequestOptions {
    device: DeviceCreate;
}

export interface UpdateDeviceOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    update: DeviceUpdate;
}

export interface StartDeviceOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    start: DeviceStart;
}

export interface StopDeviceOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
}

export interface GetDeviceRunsOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
}

export interface ReadLogsOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    instanceId: number;
}

export interface ListSnapshotsOptions extends RceManagementRequestOptions, RceManagementPagingOptions {
    deviceId: DeviceId;
}

export interface CreateSnapshotOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    snapshot: SnapshotCreate;
}

export interface GetSnapshotOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    snapshotId: number;
}

export interface UpdateSnapshotOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    snapshotId: number;
    update: SnapshotUpdate;
}

export interface DeleteSnapshotOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
    snapshotId: number;
}

export interface FindDeviceByEsnOptions extends RceManagementRequestOptions {
    esn: string;
}

export interface GetInstanceUrlOptions extends RceManagementRequestOptions {
    device: RceDeviceConfig;
}

export interface GetRunningInstanceApiUrlOptions extends RceManagementRequestOptions {
    deviceId: DeviceId;
}

interface SendOptions {
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    /**
     * RCE bearer token to use for this request, overriding the client's constructor token.
     */
    token?: string;
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

export interface RceDeviceInstance {
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

export interface RceDevice {
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
    running_device?: RceDeviceInstance | null;
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

export interface Snapshot {
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

export interface FirmwareVersion {
    firmware_version_id: string;
    device_type: DeviceType;
    display_name?: string | null;
}

export interface UserOrganisation {
    id: number;
    idp_id: string;
    name: string;
    max_devices: number;
    max_snapshots: number;
    max_project_runtime: number;
    current_devices: Record<string, number>;
}

export interface User {
    id: string;
    username: string;
    full_name?: string | null;
    email?: string | null;
    organisation: UserOrganisation;
}
