import { expect } from 'chai';
import { createSandbox } from 'sinon';
import * as needle from 'needle';
import { RceManagementClient } from './RceManagementClient';
import { expectThrowsAsync } from './testUtils.spec';

const sinon = createSandbox();

describe('RceManagementClient', () => {
    afterEach(() => {
        sinon.restore();
    });

    /**
     * Stub needle to answer each request with a 200 carrying the next body from `bodies` (requests
     * beyond the list reuse the last body; an empty object when none are given), capturing each
     * request's url and options so tests can assert on what was actually sent (url and query
     * string, Authorization header, timeout timers, ...).
     */
    function stubNeedle(...bodies: unknown[]) {
        const requests: Array<{ method: string; url: string; data: unknown; options: needle.NeedleOptions }> = [];
        sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
            const body = bodies.length > 0 ? bodies[Math.min(requests.length, bodies.length - 1)] : {};
            requests.push({ method: method, url: url, data: data, options: options });
            callback(null, { statusCode: 200, body: body });
            return {} as any;
        }) as any);
        return requests;
    }

    describe('token handling', () => {
        it('sends the constructor token when a call supplies none', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'constructor-token' });

            await client.getUserInfo();

            expect(requests[0].options.headers.Authorization).to.equal('Bearer constructor-token');
        });

        it('prefers a per-call token over the constructor token', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'constructor-token' });

            await client.getUserInfo({ token: 'override-token' });
            await client.listDevices({ token: 'override-token' });
            await client.getDevice({ deviceId: 123, token: 'override-token' });

            expect(requests.map((request) => request.options.headers.Authorization)).to.eql([
                'Bearer override-token',
                'Bearer override-token',
                'Bearer override-token'
            ]);
        });

        it('threads a per-call token through both nested calls of an esn resolution', async () => {
            const requests = stubNeedle(
                //the listDevices response: the device inventory containing the esn being resolved
                [{ id: 42, serial_number: 'XY123' }],
                //the getDevice response: that device, running
                { id: 42, status: 'running', running_device: { instance_api_url: 'https://device.rce.roku.com/instance/xyz' } }
            );
            const client = new RceManagementClient({ token: 'constructor-token' });

            const instanceUrl = await client.getInstanceUrl({ device: { esn: 'XY123' }, token: 'override-token' });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/xyz');
            //the full esn resolution ran: the inventory list, then the device lookup by the id it found
            expect(requests.map((request) => request.url)).to.eql([
                'https://api.rce.roku.com/api/v1/devices?items=0',
                'https://api.rce.roku.com/api/v1/devices/42'
            ]);
            //and the per-call override rode both requests, not just the first
            expect(requests.map((request) => request.options.headers.Authorization)).to.eql([
                'Bearer override-token',
                'Bearer override-token'
            ]);
        });
    });

    describe('request timeout', () => {
        it('maps the configured timeout to both needle timers (connection and first response byte)', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret', timeout: 12345 });

            await client.getUserInfo();

            expect(requests[0].options.open_timeout).to.equal(12345);
            expect(requests[0].options.response_timeout).to.equal(12345);
        });

        it('defaults the timeout to 30 seconds', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            await client.getUserInfo();

            expect(requests[0].options.open_timeout).to.equal(30000);
            expect(requests[0].options.response_timeout).to.equal(30000);
        });

        it('closes the socket after every request instead of pooling it (which would hold the process open)', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            await client.getUserInfo();

            expect(requests[0].options.connection).to.equal('close');
            expect(requests[0].options.agent).to.equal(false);
        });
    });

    describe('pagination', () => {
        it('forwards items and page to the paginated list endpoints', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            await client.listDevices({ items: 25, page: 3 });
            await client.listFirmwareVersions({ items: 25, page: 3 });
            await client.listSnapshots({ deviceId: 42, items: 25, page: 3 });

            expect(requests.map((request) => request.url)).to.eql([
                'https://api.rce.roku.com/api/v1/devices?items=25&page=3',
                'https://api.rce.roku.com/api/v1/firmwareVersions?items=25&page=3',
                'https://api.rce.roku.com/api/v1/devices/42/snapshots?items=25&page=3'
            ]);
        });

        it('omits paging params entirely when none are given, deferring to the api defaults', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            await client.listDevices();
            await client.listFirmwareVersions();

            expect(requests.map((request) => request.url)).to.eql([
                'https://api.rce.roku.com/api/v1/devices',
                'https://api.rce.roku.com/api/v1/firmwareVersions'
            ]);
        });

        it('findDeviceByEsn searches the whole device inventory (items=0, the api\'s no-limit value)', async () => {
            const requests = stubNeedle([]);
            const client = new RceManagementClient({ token: 'secret' });

            const device = await client.findDeviceByEsn({ esn: 'XY123' });

            expect(device).to.be.undefined;
            expect(requests[0].url).to.equal('https://api.rce.roku.com/api/v1/devices?items=0');
        });
    });

    describe('getInstanceUrl', () => {
        it('uses an instanceUrl-addressed config directly (stripping trailing slashes) without touching the management api', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            const sendStub = sinon.stub(client as any, 'send');

            const instanceUrl = await client.getInstanceUrl({ device: { instanceUrl: 'https://device.rce.roku.com/instance/abc/' } });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/abc');
            expect(sendStub.called).to.be.false;
        });

        it('resolves an id-addressed config to its running instance url through the management api', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            //send() resolves already-camelCased responses, so direct stubs use the camel shape
            const sendStub = sinon.stub(client as any, 'send').resolves({
                id: 123,
                status: 'running',
                runningDevice: { instanceApiUrl: 'https://device.rce.roku.com/instance/abc/' }
            });

            const instanceUrl = await client.getInstanceUrl({ device: { id: 123 } });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/abc');
            expect(sendStub.getCall(0).args[1]).to.equal('/devices/123');
        });

        it('resolves an esn-addressed config by finding the device then resolving its running instance url', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            const sendStub = sinon.stub(client as any, 'send');
            sendStub.onFirstCall().resolves([
                { id: 41, serialNumber: 'OTHER' },
                { id: 42, serialNumber: 'XY123' }
            ]);
            sendStub.onSecondCall().resolves({
                id: 42,
                status: 'running',
                runningDevice: { instanceApiUrl: 'https://device.rce.roku.com/instance/xyz' }
            });

            const instanceUrl = await client.getInstanceUrl({ device: { esn: 'XY123' } });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/xyz');
            expect(sendStub.getCall(0).args[1]).to.equal('/devices');
            expect(sendStub.getCall(1).args[1]).to.equal('/devices/42');
        });

        it('coerces a numeric string id from an untyped (json) config', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            const sendStub = sinon.stub(client as any, 'send').resolves({
                id: 123,
                status: 'running',
                runningDevice: { instanceApiUrl: 'https://device.rce.roku.com/instance/abc' }
            });

            await client.getInstanceUrl({ device: { id: '123' } as any });

            expect(sendStub.getCall(0).args[1]).to.equal('/devices/123');
        });

        it('throws a clear error for a non-numeric device id instead of requesting /devices/NaN', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            //the id type is number, but device configs also arrive from untyped json, hence the casts
            await expectThrowsAsync(
                client.getInstanceUrl({ device: { id: '12a' } as any }),
                `Invalid RCE device id '12a': expected a numeric id`
            );
            //an empty id would otherwise coerce to 0 and query /devices/0
            await expectThrowsAsync(
                client.getInstanceUrl({ device: { id: '' } as any }),
                `Invalid RCE device id '': expected a numeric id`
            );
            expect(requests).to.be.empty;
        });

        it('throws when no device matches the esn', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            sinon.stub(client as any, 'send').resolves([]);

            await expectThrowsAsync(
                client.getInstanceUrl({ device: { esn: 'XY123' } }),
                `No RCE device found with esn 'XY123'`
            );
        });

        it('throws when the device is not running', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            sinon.stub(client as any, 'send').resolves({ id: 123, status: 'shutdown' });

            await expectThrowsAsync(
                client.getInstanceUrl({ device: { id: 123 } }),
                `Device 123 is not running (status 'shutdown'); start it before connecting to its instance`
            );
        });
    });

    describe('endpoint wrappers', () => {
        it('sends each device endpoint with its method, path, and body', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            await client.createDevice({ device: { name: 'new-device', deviceType: 'tv' } });
            await client.updateDevice({ deviceId: 42, update: { name: 'renamed' } });
            await client.startDevice({ deviceId: 42, start: { snapshotId: 7, firmwareVersionId: 'rce-fw:15.2.4-tv_prod', maxRuntime: 3600 } });
            await client.stopDevice({ deviceId: 42 });
            await client.getDeviceRuns({ deviceId: 42 });
            await client.readLogs({ deviceId: 42, instanceId: 397 });

            expect(requests.map((request) => [request.method, request.url])).to.eql([
                ['post', 'https://api.rce.roku.com/api/v1/devices'],
                ['patch', 'https://api.rce.roku.com/api/v1/devices/42'],
                ['post', 'https://api.rce.roku.com/api/v1/devices/42/start'],
                ['post', 'https://api.rce.roku.com/api/v1/devices/42/stop'],
                ['get', 'https://api.rce.roku.com/api/v1/devices/42/runs'],
                ['get', 'https://api.rce.roku.com/api/v1/devices/42/logs/397']
            ]);
            //the wire bodies are snake_case: the client converts camelCase input on the way out
            expect(requests[0].data).to.eql({ name: 'new-device', device_type: 'tv' });
            expect(requests[1].data).to.eql({ name: 'renamed' });
            expect(requests[2].data).to.eql({ snapshot_id: 7, firmware_version_id: 'rce-fw:15.2.4-tv_prod', max_runtime: 3600 });
        });

        it('sends each snapshot endpoint with its method, path, and body', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret' });

            await client.createSnapshot({ deviceId: 42, snapshot: { name: 'before-test' } });
            await client.getSnapshot({ deviceId: 42, snapshotId: 7 });
            await client.updateSnapshot({ deviceId: 42, snapshotId: 7, update: { name: 'after-test' } });
            await client.deleteSnapshot({ deviceId: 42, snapshotId: 7 });

            expect(requests.map((request) => [request.method, request.url])).to.eql([
                ['post', 'https://api.rce.roku.com/api/v1/devices/42/snapshots'],
                ['get', 'https://api.rce.roku.com/api/v1/devices/42/snapshots/7'],
                ['patch', 'https://api.rce.roku.com/api/v1/devices/42/snapshots/7'],
                ['delete', 'https://api.rce.roku.com/api/v1/devices/42/snapshots/7']
            ]);
            expect(requests[0].data).to.eql({ name: 'before-test' });
            expect(requests[2].data).to.eql({ name: 'after-test' });
        });
    });

    describe('wire casing conversion', () => {
        it('converts snake_case response keys (nested and in arrays) to camelCase', async () => {
            stubNeedle({
                id: 42,
                device_type: 'tv',
                serial_number: 'XY123',
                created_at: '2026-01-01',
                running_device: {
                    instance_api_url: 'https://device.rce.roku.com/instance/abc',
                    janus_ice_servers: [{ urls: ['stun:example.com'], username: null }]
                }
            });
            const client = new RceManagementClient({ token: 'secret' });

            const device = await client.getDevice({ deviceId: 42 });

            expect(device).to.eql({
                id: 42,
                deviceType: 'tv',
                serialNumber: 'XY123',
                createdAt: '2026-01-01',
                runningDevice: {
                    instanceApiUrl: 'https://device.rce.roku.com/instance/abc',
                    janusIceServers: [{ urls: ['stun:example.com'], username: null }]
                }
            });
        });

        it('passes the caller-defined `properties` bag through untouched in both directions', async () => {
            const requests = stubNeedle({
                id: 42,
                device_type: 'tv',
                properties: { my_custom_key: 'as-i-wrote-it', 'kebab-key': 1 }
            });
            const client = new RceManagementClient({ token: 'secret' });

            const device = await client.createDevice({
                device: { name: 'new-device', deviceType: 'tv', properties: { my_custom_key: 'as-i-wrote-it', 'kebab-key': 1 } }
            });

            //outbound: schema keys converted to snake, properties contents untouched
            expect(requests[0].data).to.eql({
                name: 'new-device',
                device_type: 'tv',
                properties: { my_custom_key: 'as-i-wrote-it', 'kebab-key': 1 }
            });
            //inbound: schema keys camelCased, properties contents untouched
            expect(device).to.eql({
                id: 42,
                deviceType: 'tv',
                properties: { my_custom_key: 'as-i-wrote-it', 'kebab-key': 1 }
            });
        });

        it('passes non-object response bodies (device logs) through unchanged', async () => {
            stubNeedle('log line one\nlog_line_two');
            const client = new RceManagementClient({ token: 'secret' });

            const logs = await client.readLogs({ deviceId: 42, instanceId: 397 });

            expect(logs).to.equal('log line one\nlog_line_two');
        });
    });

    describe('base url', () => {
        it('uses a custom base url with trailing slashes stripped', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'secret', baseUrl: 'https://example.com/api/v1/' });

            await client.getUserInfo();

            expect(requests[0].url).to.equal('https://example.com/api/v1/user/me');
        });
    });

    describe('send failures', () => {
        it('rejects with the transport error when needle reports one', async () => {
            sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
                callback(new Error('socket hang up'), undefined);
                return {} as any;
            }) as any);
            const client = new RceManagementClient({ token: 'secret' });

            await expectThrowsAsync(
                client.getUserInfo(),
                'socket hang up'
            );
        });

        it('rejects with method, path, and status on a non-2xx response', async () => {
            sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
                callback(null, { statusCode: 404, body: {} });
                return {} as any;
            }) as any);
            const client = new RceManagementClient({ token: 'secret' });

            await expectThrowsAsync(
                client.getUserInfo(),
                'RCE management GET /user/me failed (status 404)'
            );
        });

        it('send defaults to the constructor token, no query, and a null body when called with no options', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'constructor-token' });

            await client['send']('get', '/user/me');

            expect(requests[0].url).to.equal('https://api.rce.roku.com/api/v1/user/me');
            expect(requests[0].options.headers.Authorization).to.equal('Bearer constructor-token');
            expect(requests[0].data).to.equal(null);
        });

        it('treats a response with no status code as a failure (status 0)', async () => {
            sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
                callback(null, { body: {} });
                return {} as any;
            }) as any);
            const client = new RceManagementClient({ token: 'secret' });

            await expectThrowsAsync(
                client.getUserInfo(),
                'RCE management GET /user/me failed (status 0)'
            );
        });
    });
});
