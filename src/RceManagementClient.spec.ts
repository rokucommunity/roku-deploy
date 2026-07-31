import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { RceManagementClient } from './RceManagementClient';
import { expectThrowsAsync } from './testUtils.spec';

const sinon = createSandbox();

describe('RceManagementClient', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('getInstanceUrl', () => {
        it('uses an instanceUrl-addressed config directly (stripping trailing slashes) without touching the management api', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            const sendStub = sinon.stub(client as any, 'send');

            const instanceUrl = await client.getInstanceUrl({ instanceUrl: 'https://device.rce.roku.com/instance/abc/' });

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

            const instanceUrl = await client.getInstanceUrl({ id: '123' });

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

            const instanceUrl = await client.getInstanceUrl({ esn: 'XY123' });

            expect(instanceUrl).to.equal('https://device.rce.roku.com/instance/xyz');
            expect(sendStub.getCall(0).args[1]).to.equal('/devices');
            expect(sendStub.getCall(1).args[1]).to.equal('/devices/42');
        });

        it('throws when no device matches the esn', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            sinon.stub(client as any, 'send').resolves([]);

            await expectThrowsAsync(
                client.getInstanceUrl({ esn: 'XY123' }),
                `No RCE device found with esn 'XY123'`
            );
        });

        it('throws when the device is not running', async () => {
            const client = new RceManagementClient({ token: 'secret' });
            sinon.stub(client as any, 'send').resolves({ id: 123, status: 'shutdown' });

            await expectThrowsAsync(
                client.getInstanceUrl({ id: '123' }),
                `Device 123 is not running (status 'shutdown'); start it before connecting to its instance`
            );
        });
    });
});
