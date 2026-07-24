import * as WebSocket from 'ws';
import * as needle from 'needle';
import type { RceDeviceConfig } from './DeviceConfig';
import { isRceByUrl, isRceById } from './DeviceConfig';
import { RceManagementClient } from './RceManagementClient';

/**
 * Client for a Roku Cloud Emulator (RCE) instance. Talks directly to the instance API
 * (for example https://device.rce.roku.com/instance/<id>/api/v0/...) using a bearer token.
 *
 * ECP on an RCE instance runs over ECP2, a WebSocket protocol, rather than the local HTTP ECP port.
 * The `ecp` method is the general primitive: it sends a single ECP2 request (any verb, for example
 * 'query-device-info' or 'key-press') and resolves with the response. Query responses carry an XML
 * document in `content`; input responses carry only a status.
 */
export class RceDevice {
    constructor(config: RceDeviceConfig, options: RceDeviceOptions = {}) {
        this.config = config;
        this.token = config.rceToken;
        this.createWebSocket = options.createWebSocket ?? ((url, requestOptions) => new WebSocket(url, requestOptions));
    }

    private readonly config: RceDeviceConfig;

    private readonly token: string | undefined;

    private readonly createWebSocket: (url: string, requestOptions: WebSocket.ClientOptions) => WebSocket;

    private resolvedInstanceUrl: string | undefined;

    /**
     * Send a single ECP2 request over the instance's auth-proxy WebSocket and resolve with the response.
     * @param request the ECP2 request verb, for example 'query-device-info' or 'key-press'
     * @param params additional request fields, for example { 'param-key': 'Home' } for key input
     */
    public async ecp(request: string, params: Record<string, string> = {}, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        const timeout = options.timeout ?? 10000;
        const instanceUrl = await this.getInstanceUrl();
        const url = this.buildWebSocketUrl(instanceUrl, '/api/v0/ecp2/auth-proxy');
        const requestId = String(++RceDevice.requestCounter);

        return new Promise<EcpResponse>((resolve, reject) => {
            const socket = this.createWebSocket(url, { headers: this.buildHeaders() });
            let settled = false;

            const finish = (error: Error | undefined, response?: EcpResponse) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                try {
                    socket.close();
                } catch {
                    // ignore close failures; we are done with the socket
                }
                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
            };

            const timer = setTimeout(() => {
                finish(new Error(`ECP2 request '${request}' timed out after ${timeout}ms`));
            }, timeout);

            socket.on('open', () => {
                socket.send(JSON.stringify({ request: request, 'request-id': requestId, ...params }));
            });
            socket.on('message', (data: WebSocket.RawData) => {
                let message: EcpRawMessage;
                try {
                    message = JSON.parse(data.toString());
                } catch {
                    return;
                }
                // ignore protocol notifications such as the auth challenge
                if (message.notify) {
                    return;
                }
                // ignore responses correlated to a different request on this socket
                if (message['response-id'] !== undefined && message['response-id'] !== requestId) {
                    return;
                }
                finish(undefined, this.parseResponse(message));
            });
            socket.on('error', (error: Error) => {
                finish(error);
            });
            socket.on('close', () => {
                finish(new Error(`ECP2 socket closed before a response to '${request}' was received`));
            });
        });
    }

    /**
     * Convenience for the most common query. Returns the device-info XML document as a string.
     */
    public async getDeviceInfoXml(options: EcpRequestOptions = {}): Promise<string> {
        const response = await this.ecp('query-device-info', {}, options);
        if (!response.content) {
            throw new Error(`RCE device-info response had no content (status ${response.status})`);
        }
        return response.content;
    }

    /**
     * Send a key event. `action` is the local ECP verb ('keypress', 'keydown', 'keyup'), mapped to the
     * ECP2 equivalent.
     */
    public sendKey(action: KeyAction, key: string, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp(RceDevice.keyActionToEcp2Request[action], { 'param-key': key }, options);
    }

    /**
     * Query the list of channels installed on the device. Maps to the ECP2 'query-apps' verb, which takes
     * no params.
     */
    public queryApps(options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('query-apps', {}, options);
    }

    /**
     * Query the currently active app (or the home screen, or a screensaver). Maps to the ECP2
     * 'query-active-app' verb, which takes no params.
     */
    public queryActiveApp(options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('query-active-app', {}, options);
    }

    /**
     * Launch a channel. Maps to the ECP2 'launch' verb.
     */
    public launch(channelId: string, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('launch', { 'param-channel-id': channelId }, options);
    }

    /**
     * Query a channel's running/exited state. Maps to the ECP2 'query-app-state' verb.
     */
    public queryAppState(channelId: string, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('query-app-state', { 'param-channel-id': channelId }, options);
    }

    /**
     * Exit a running channel. Maps to the ECP2 'exit-app' verb.
     */
    public exitApp(channelId: string, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('exit-app', { 'param-channel-id': channelId }, options);
    }

    /**
     * Query a channel's registry contents. Maps to the ECP2 'query-registry' verb.
     * Deliberately different from the other channel-scoped verbs above: query-registry identifies the
     * channel with a 'param-id' field, not 'param-channel-id'.
     */
    public queryRegistry(channelId: string, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('query-registry', { 'param-id': channelId }, options);
    }

    /**
     * Query the current SceneGraph rendezvous state. Maps to the ECP2 'query-sgrendezvous' verb, which
     * takes no params.
     */
    public queryRendezvous(options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('query-sgrendezvous', {}, options);
    }

    /**
     * Turn SceneGraph rendezvous tracking on or off. Deliberately different from the other verbs
     * above: this is the bare 'sgrendezvous' verb, and the on/off state is carried as the VALUE of a
     * 'param-track' field ('track' or 'untrack'), mirroring the local HTTP ECP path
     * `/sgrendezvous/{track|untrack}` rather than a boolean-ish param.
     */
    public setRendezvousTracking(enabled: boolean, options: EcpRequestOptions = {}): Promise<EcpResponse> {
        return this.ecp('sgrendezvous', { 'param-track': enabled ? 'track' : 'untrack' }, options);
    }

    /**
     * Enter the developer-settings key combo on the device (the same combo a physical remote's
     * key sequence would send). The device then shows the on-screen developer setup wizard for the
     * user to complete; this call only triggers that screen, it does not finish the setup itself.
     */
    public async sendDeveloperSettingsCombo(): Promise<void> {
        const instanceUrl = await this.getInstanceUrl();
        await this.postToInstanceApi(instanceUrl, '/api/v0/xi/developer-settings-combo');
    }

    private parseResponse(message: EcpRawMessage): EcpResponse {
        const statusNumber = Number.parseInt(message.status, 10);
        return {
            response: message.response,
            status: Number.isNaN(statusNumber) ? undefined : statusNumber,
            statusMessage: message['status-msg'],
            contentType: message['content-type'],
            content: message['content-data'] ? Buffer.from(message['content-data'], 'base64').toString('utf8') : undefined
        };
    }

    /**
     * Resolve (and cache) the instance API URL for this device. When configured by instanceUrl it is
     * used directly; when configured by id or esn it is resolved through the RCE management API.
     */
    public async getInstanceUrl(): Promise<string> {
        if (this.resolvedInstanceUrl) {
            return this.resolvedInstanceUrl;
        }
        let instanceUrl: string;
        if (isRceByUrl(this.config)) {
            instanceUrl = this.config.instanceUrl;
        } else if (isRceById(this.config)) {
            instanceUrl = await this.createManagementClient().getRunningInstanceApiUrl(this.config.id);
        } else {
            const managementClient = this.createManagementClient();
            const device = await managementClient.findDeviceByEsn(this.config.esn);
            if (!device) {
                throw new Error(`No RCE device found with esn '${this.config.esn}'`);
            }
            instanceUrl = await managementClient.getRunningInstanceApiUrl(device.id);
        }
        this.resolvedInstanceUrl = instanceUrl.replace(/\/+$/, '');
        return this.resolvedInstanceUrl;
    }

    /**
     * Create the management client used to resolve a device id or esn to its running instance URL.
     * Split out so tests can supply a fake.
     */
    protected createManagementClient(): RceManagementClient {
        if (!this.token) {
            throw new Error('An rceToken is required to resolve an RCE device by id or esn');
        }
        return new RceManagementClient({ token: this.token });
    }

    private buildWebSocketUrl(instanceUrl: string, apiPath: string): string {
        const url = new URL(instanceUrl + apiPath);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.toString();
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        return headers;
    }

    /**
     * POST to a bodyless instance-api endpoint (bearer-authed like everything else on the instance
     * api). Single choke point so tests can stub one method rather than the network.
     */
    private postToInstanceApi(instanceUrl: string, apiPath: string): Promise<void> {
        const url = instanceUrl + apiPath;
        const needleOptions: needle.NeedleOptions = {
            json: true,
            headers: this.buildHeaders()
        };
        return new Promise<void>((resolve, reject) => {
            needle.request('post', url, null, needleOptions, (error, response) => {
                if (error) {
                    reject(error);
                    return;
                }
                const statusCode = response.statusCode ?? 0;
                if (statusCode < 200 || statusCode >= 300) {
                    reject(new Error(`RCE instance POST ${apiPath} failed (status ${statusCode})`));
                    return;
                }
                resolve();
            });
        });
    }

    private static requestCounter = 0;

    private static readonly keyActionToEcp2Request: Record<KeyAction, string> = {
        keypress: 'key-press',
        keydown: 'key-down',
        keyup: 'key-up'
    };
}

export type KeyAction = 'keypress' | 'keydown' | 'keyup';

export interface RceDeviceOptions {
    /**
     * Factory for the WebSocket used by ecp(). Defaults to a real `ws` WebSocket; tests supply a fake
     * so they can exercise the ECP2 request/response flow without a real network connection.
     */
    createWebSocket?: (url: string, requestOptions: WebSocket.ClientOptions) => WebSocket;
}

export interface EcpRequestOptions {
    /**
     * How long to wait for a response before rejecting, in milliseconds. Defaults to 10000.
     */
    timeout?: number;
}

export interface EcpResponse {
    /**
     * The ECP2 response verb, echoing the request (for example 'query-device-info').
     */
    response: string;
    /**
     * Numeric status code, for example 200 for a completed query or 202 for an accepted key event.
     */
    status?: number;
    statusMessage?: string;
    contentType?: string;
    /**
     * The response body (for queries, an XML document), decoded from the base64 content-data field.
     */
    content?: string;
}

interface EcpRawMessage {
    notify?: string;
    response?: string;
    'response-id'?: string;
    status?: string;
    'status-msg'?: string;
    'content-type'?: string;
    'content-data'?: string;
}
