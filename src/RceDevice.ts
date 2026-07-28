import * as needle from 'needle';
import type { RceDeviceConfig } from './DeviceConfig';
import { isRceByUrl, isRceById } from './DeviceConfig';
import { RceManagementClient } from './RceManagementClient';

/**
 * Client for a Roku Cloud Emulator (RCE) instance's own API (for example
 * https://device.rce.roku.com/instance/<id>/api/v0/...) using a bearer token: resolving a device
 * addressed by instanceUrl, id, or esn to its live instance URL, and instance-api actions like the
 * developer-settings key combo. ECP traffic does not live here - the instance's `/ecp1` proxy
 * forwards plain HTTP ECP, so RokuDeploy's `ecp()` transport addresses cloud devices the same way
 * it addresses local ones.
 */
export class RceDevice {
    constructor(config: RceDeviceConfig) {
        this.config = config;
        this.token = config.rceToken;
    }

    private readonly config: RceDeviceConfig;

    private readonly token: string | undefined;

    private resolvedInstanceUrl: string | undefined;

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
}
