import * as needle from 'needle';
import * as WebSocket from 'ws';
import type { RceDeviceConfig } from './DeviceConfig';
import { isRceByUrl, isRceById } from './DeviceConfig';
import { RceManagementClient } from './RceManagementClient';

/**
 * Client for a Roku Cloud Emulator (RCE) instance's own API (for example
 * https://device.rce.roku.com/instance/<id>/api/v0/...) using a bearer token: resolving a device
 * addressed by instanceUrl, id, or esn to its live instance URL, and instance-api actions like the
 * developer-settings key combo. Everyday ECP traffic does not live here - the instance's `/ecp1`
 * proxy forwards plain HTTP ECP, so RokuDeploy's `ecp()` transport addresses cloud devices the same
 * way it addresses local ones. The exception is sendKeySequence, which rides the instance's ECP2
 * auth-proxy WebSocket: that channel carries an authenticated ECP session (the same trust level the
 * mobile app gets), so it keeps working when the device's limited ECP mode 403s the plain proxy.
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
     * Press a sequence of remote keys, in order, over the instance's ECP2 auth-proxy WebSocket.
     * Keys use the local ECP names ('Home', 'Up', 'Select', ...). Each press waits for the previous
     * press's response plus a small delay (keyDelayMs) so on-screen navigation keeps up; the first
     * non-2xx response throws with the failing key and step.
     *
     * This deliberately does NOT go through the `/ecp1` proxy RokuDeploy.keyPress uses: that proxy
     * forwards unauthenticated ECP, which a device in limited ECP mode rejects with an empty 403.
     * The auth-proxy completes the ECP2 authentication challenge, so key input works regardless of
     * the device's ECP mode - which is what makes key macros like the disable-limited-ECP sequence
     * possible in the first place.
     */
    public async sendKeySequence(keys: string[], options: SendKeySequenceOptions = {}): Promise<void> {
        const keyDelayMs = options.keyDelayMs ?? 250;
        for (let stepIndex = 0; stepIndex < keys.length; stepIndex++) {
            if (stepIndex > 0 && keyDelayMs > 0) {
                await new Promise((resolve) => {
                    setTimeout(resolve, keyDelayMs);
                });
            }
            const key = keys[stepIndex];
            const response = await this.sendEcp2Request('key-press', { 'param-key': key }, options);
            if (response.status === undefined || response.status < 200 || response.status >= 300) {
                throw new Error(`Key press '${key}' (step ${stepIndex + 1} of ${keys.length}) failed with ECP2 status ${response.status ?? 'unknown'}${response.statusMessage ? `: ${response.statusMessage}` : ''}`);
            }
        }
    }

    /**
     * Send a single ECP2 request over the instance's auth-proxy WebSocket and resolve with the
     * response (one socket per request, closed once the response arrives).
     */
    private async sendEcp2Request(request: string, params: Record<string, string>, options: { timeout?: number } = {}): Promise<Ecp2Response> {
        const timeout = options.timeout ?? 10000;
        const instanceUrl = await this.getInstanceUrl();
        const url = this.buildWebSocketUrl(instanceUrl, '/api/v0/ecp2/auth-proxy');
        const requestId = String(++RceDevice.requestCounter);

        return new Promise<Ecp2Response>((resolve, reject) => {
            const socket = this.createWebSocket(url, { headers: this.buildHeaders() });
            let settled = false;

            const finish = (error: Error | undefined, response?: Ecp2Response) => {
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
                let message: Ecp2RawMessage;
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
                const statusNumber = Number.parseInt(message.status, 10);
                finish(undefined, {
                    response: message.response,
                    status: Number.isNaN(statusNumber) ? undefined : statusNumber,
                    statusMessage: message['status-msg']
                });
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
     * Enter the developer-settings key combo on the device (the same combo a physical remote's
     * key sequence would send). The device then shows the on-screen developer setup wizard for the
     * user to complete; this call only triggers that screen, it does not finish the setup itself.
     */
    public async sendDeveloperSettingsCombo(): Promise<void> {
        const instanceUrl = await this.getInstanceUrl();
        await this.postToInstanceApi(instanceUrl, '/api/v0/xi/developer-settings-combo');
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
}

export interface RceDeviceOptions {
    /**
     * Factory for the WebSocket used by sendKeySequence. Defaults to a real `ws` WebSocket; tests
     * supply a fake so they can exercise the ECP2 request/response flow without a network connection.
     */
    createWebSocket?: (url: string, requestOptions: WebSocket.ClientOptions) => WebSocket;
}

export interface SendKeySequenceOptions {
    /**
     * How long to wait for each key press's response before rejecting, in milliseconds.
     * Defaults to 10000.
     */
    timeout?: number;
    /**
     * The pause between consecutive key presses, in milliseconds, so on-screen navigation keeps up
     * with the input. Defaults to 250.
     */
    keyDelayMs?: number;
}

interface Ecp2Response {
    /**
     * The ECP2 response verb, echoing the request (for example 'key-press').
     */
    response: string;
    /**
     * Numeric status code, for example 200 for a completed request or 202 for an accepted key event.
     */
    status?: number;
    statusMessage?: string;
}

interface Ecp2RawMessage {
    notify?: string;
    response?: string;
    'response-id'?: string;
    status?: string;
    'status-msg'?: string;
}
