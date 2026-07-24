import { expect } from 'chai';
import { createSandbox } from 'sinon';
import * as needle from 'needle';
import { RceDevice } from './RceDevice';

const sinon = createSandbox();

describe('RceDevice', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('sendDeveloperSettingsCombo', () => {
        /** captured args from the stubbed needle call */
        let requestArgs: { method: string; url: string; data: any; options: needle.NeedleOptions };

        function stubNeedleRequest(error: any, response: any) {
            return sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
                requestArgs = { method: method, url: url, data: data, options: options };
                callback(error, response);
                return {} as any;
            }) as any);
        }

        it('POSTs to the instance api developer-settings-combo endpoint with bearer auth and no body', async () => {
            stubNeedleRequest(null, { statusCode: 200 });
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            await device.sendDeveloperSettingsCombo();

            expect(requestArgs.method).to.equal('post');
            expect(requestArgs.url).to.equal('https://device.rce.roku.com/instance/abc/api/v0/xi/developer-settings-combo');
            expect(requestArgs.data).to.be.null;
            expect(requestArgs.options.headers).to.eql({ Authorization: 'Bearer secret' });
        });

        it('resolves without a value on a successful response', async () => {
            stubNeedleRequest(null, { statusCode: 200 });
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            expect(await device.sendDeveloperSettingsCombo()).to.be.undefined;
        });

        it('throws a descriptive error on a non-2xx response', async () => {
            stubNeedleRequest(null, { statusCode: 500 });
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            let caughtError: Error;
            try {
                await device.sendDeveloperSettingsCombo();
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('developer-settings-combo');
            expect(caughtError?.message).to.contain('500');
        });

        it('rejects with the underlying error when the request itself fails', async () => {
            const networkError = new Error('socket hang up');
            stubNeedleRequest(networkError, undefined);
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            let caughtError: Error;
            try {
                await device.sendDeveloperSettingsCombo();
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError).to.equal(networkError);
        });

        it('strips a trailing slash from the instance url before building the request url', async () => {
            stubNeedleRequest(null, { statusCode: 200 });
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc/', rceToken: 'secret' });

            await device.sendDeveloperSettingsCombo();

            expect(requestArgs.url).to.equal('https://device.rce.roku.com/instance/abc/api/v0/xi/developer-settings-combo');
        });
    });
});
