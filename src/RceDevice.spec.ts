import { expect } from 'chai';
import { createSandbox } from 'sinon';
import * as needle from 'needle';
import { RceDevice } from './RceDevice';

const sinon = createSandbox();

describe('RceDevice', () => {
    /** captured args from every request made through the stubbed needle call, in order */
    let requests: Array<{ method: string; url: string; data: any; options: needle.NeedleOptions }>;

    beforeEach(() => {
        requests = [];
    });

    afterEach(() => {
        sinon.restore();
    });

    /**
     * Stub needle so every request is captured into `requests` and answered by `respond` (which can
     * vary the response per request, for example failing only the first key press).
     */
    function stubNeedleRequest(respond: (requestIndex: number) => { error?: any; response?: any }) {
        return sinon.stub(needle, 'request').callsFake(((method: string, url: string, data: any, options: any, callback: any) => {
            const { error, response } = respond(requests.length);
            requests.push({ method: method, url: url, data: data, options: options });
            callback(error ?? null, response);
            return {} as any;
        }) as any);
    }

    describe('sendKeySequence', () => {
        it('presses every key in order through the instance-api key route with bearer auth', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 200 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            await device.sendKeySequence(['Home', 'Up', 'Select'], { keyDelayMs: 0 });

            expect(requests.map((request) => request.url)).to.eql([
                'https://device.rce.roku.com/instance/abc/api/v0/ecp1/keypress/Home',
                'https://device.rce.roku.com/instance/abc/api/v0/ecp1/keypress/Up',
                'https://device.rce.roku.com/instance/abc/api/v0/ecp1/keypress/Select'
            ]);
            expect(requests.every((request) => request.method === 'post')).to.be.true;
            expect(requests[0].options.headers).to.eql({ Authorization: 'Bearer secret' });
        });

        it('accepts a 202 (accepted key event) as success', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 202 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            await device.sendKeySequence(['Home'], { keyDelayMs: 0 });

            expect(requests.length).to.equal(1);
        });

        it('stops at the first non-2xx response with the failing key and step in the error', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 403 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            let caughtError: Error;
            try {
                await device.sendKeySequence(['Home', 'Up'], { keyDelayMs: 0 });
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.contain(`Key press 'Home'`);
            expect(caughtError?.message).to.contain('step 1 of 2');
            expect(caughtError?.message).to.contain('403');
            //the second key was never sent
            expect(requests.length).to.equal(1);
        });

        it('wraps a network failure with the failing key and step', async () => {
            stubNeedleRequest(() => ({ error: new Error('socket hang up') }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            let caughtError: Error;
            try {
                await device.sendKeySequence(['Home'], { keyDelayMs: 0 });
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.contain(`Key press 'Home'`);
            expect(caughtError?.message).to.contain('step 1 of 1');
            expect(caughtError?.message).to.contain('socket hang up');
        });

        it('passes the per-press timeout through to the request', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 200 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            await device.sendKeySequence(['Home'], { keyDelayMs: 0, timeout: 1234 });

            expect(requests[0].options.timeout).to.equal(1234);
        });
    });

    describe('sendDeveloperSettingsCombo', () => {
        it('POSTs to the instance api developer-settings-combo endpoint with bearer auth and no body', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 200 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            await device.sendDeveloperSettingsCombo();

            expect(requests[0].method).to.equal('post');
            expect(requests[0].url).to.equal('https://device.rce.roku.com/instance/abc/api/v0/xi/developer-settings-combo');
            expect(requests[0].data).to.be.null;
            expect(requests[0].options.headers).to.eql({ Authorization: 'Bearer secret' });
        });

        it('resolves without a value on a successful response', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 200 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' });

            expect(await device.sendDeveloperSettingsCombo()).to.be.undefined;
        });

        it('throws a descriptive error on a non-2xx response', async () => {
            stubNeedleRequest(() => ({ response: { statusCode: 500 } }));
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
            stubNeedleRequest(() => ({ error: networkError }));
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
            stubNeedleRequest(() => ({ response: { statusCode: 200 } }));
            const device = new RceDevice({ instanceUrl: 'https://device.rce.roku.com/instance/abc/', rceToken: 'secret' });

            await device.sendDeveloperSettingsCombo();

            expect(requests[0].url).to.equal('https://device.rce.roku.com/instance/abc/api/v0/xi/developer-settings-combo');
        });
    });
});
