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
        const requests: Array<{ url: string; options: needle.NeedleOptions }> = [];
        sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
            const body = bodies.length > 0 ? bodies[Math.min(requests.length, bodies.length - 1)] : {};
            requests.push({ url: url, options: options });
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

            expect(requests[0].url).to.equal('https://api.rce.roku.com/api/v1/devices');
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
            const sendStub = sinon.stub(client as any, 'send').resolves({
                id: 123,
                status: 'running',
                running_device: { instance_api_url: 'https://device.rce.roku.com/instance/abc/' }
            });

            const instanceUrl = await client.getInstanceUrl({ device: { id: '123' } });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/abc');
            expect(sendStub.getCall(0).args[1]).to.equal('/devices/123');
        });

        it('resolves an esn-addressed config by finding the device then resolving its running instance url', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            const sendStub = sinon.stub(client as any, 'send');
            sendStub.onFirstCall().resolves([
                { id: 41, serial_number: 'OTHER' },
                { id: 42, serial_number: 'XY123' }
            ]);
            sendStub.onSecondCall().resolves({
                id: 42,
                status: 'running',
                running_device: { instance_api_url: 'https://device.rce.roku.com/instance/xyz' }
            });

            const instanceUrl = await client.getInstanceUrl({ device: { esn: 'XY123' } });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/xyz');
            expect(sendStub.getCall(0).args[1]).to.equal('/devices');
            expect(sendStub.getCall(1).args[1]).to.equal('/devices/42');
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
                client.getInstanceUrl({ device: { id: '123' } }),
                `Device 123 is not running (status 'shutdown'); start it before connecting to its instance`
            );
        });
    });
});
