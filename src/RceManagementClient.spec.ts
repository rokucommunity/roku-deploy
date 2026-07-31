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

    describe('token handling', () => {
        /**
         * Stub needle to answer every request with an empty 200, capturing the request options so
         * tests can assert on the Authorization header actually sent.
         */
        function stubNeedle() {
            const requests: Array<{ options: needle.NeedleOptions }> = [];
            sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
                requests.push({ options: options });
                callback(null, { statusCode: 200, body: {} });
                return {} as any;
            }) as any);
            return requests;
        }

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

        it('threads a per-call token through the nested calls of an esn resolution', async () => {
            const requests = stubNeedle();
            const client = new RceManagementClient({ token: 'constructor-token' });

            //listDevices returns nothing, so the esn lookup fails - but both requests carry the override
            await expectThrowsAsync(client.getInstanceUrl({ device: { esn: 'XY123' }, token: 'override-token' }));

            expect(requests[0].options.headers.Authorization).to.equal('Bearer override-token');
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
