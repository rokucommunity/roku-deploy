import { expect } from 'chai';
import { createSandbox } from 'sinon';
import * as needle from 'needle';
import { EventEmitter } from 'events';
import type * as WebSocket from 'ws';
import { RceDevice } from './RceDevice';

const sinon = createSandbox();

/**
 * Minimal fake standing in for a real `ws` socket. A real `ws` socket is itself an EventEmitter
 * (`on('open'|'message'|'error'|'close', ...)`), so extending Node's EventEmitter directly gives
 * correct on/once/removeAllListeners/emit semantics.
 */
class FakeWebSocket extends EventEmitter {
    public static readonly CONNECTING = 0;

    public static readonly OPEN = 1;

    public static readonly CLOSED = 3;

    public sentFrames: string[] = [];

    public closed = false;

    public readyState: number = FakeWebSocket.CONNECTING;

    public send(data: string): void {
        this.sentFrames.push(data);
    }

    //real ws transitions readyState to OPEN right before emitting 'open'; mirror that here
    public emit(event: string | symbol, ...args: any[]): boolean {
        if (event === 'open') {
            this.readyState = FakeWebSocket.OPEN;
        }
        return super.emit(event, ...args);
    }

    public close(): void {
        this.closed = true;
        this.readyState = FakeWebSocket.CLOSED;
    }
}

/**
 * Parses the JSON frame most recently sent by the fake websocket (the ECP2 request).
 */
function lastSentRequest(fakeWebSocket: FakeWebSocket): Record<string, string> {
    return JSON.parse(fakeWebSocket.sentFrames[fakeWebSocket.sentFrames.length - 1]);
}

/**
 * Builds an ECP2 response frame echoing the request-id from whatever the fake websocket most
 * recently sent, so the response correlates with RceDevice#ecp's `response-id` matching.
 */
function buildEcp2ResponseFrame(fakeWebSocket: FakeWebSocket, verb: string, xmlContent: string, status = '200'): string {
    const sentRequest = lastSentRequest(fakeWebSocket);
    return JSON.stringify({
        response: verb,
        'response-id': sentRequest['request-id'],
        status: status,
        'status-msg': 'OK',
        'content-type': 'text/xml',
        'content-data': Buffer.from(xmlContent, 'utf8').toString('base64')
    });
}

/**
 * Lets any pending microtasks (the getInstanceUrl() await inside ecp()) settle before the fake
 * websocket is exercised.
 */
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

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

    describe('ecp verb methods', () => {
        let fakeWebSocket: FakeWebSocket;
        let capturedWebSocketUrl: string | undefined;
        let capturedWebSocketOptions: WebSocket.ClientOptions | undefined;

        function createDevice(): RceDevice {
            fakeWebSocket = new FakeWebSocket();
            capturedWebSocketUrl = undefined;
            capturedWebSocketOptions = undefined;
            return new RceDevice(
                { instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' },
                {
                    createWebSocket: (url, requestOptions) => {
                        capturedWebSocketUrl = url;
                        capturedWebSocketOptions = requestOptions;
                        return fakeWebSocket as unknown as WebSocket;
                    }
                }
            );
        }

        /**
         * Drives one ECP2 request/response round trip against the fake websocket: lets the
         * getInstanceUrl()-driven microtasks settle, opens the socket (which triggers the outgoing
         * request frame), then answers with a scripted response frame correlated to the request's
         * echoed request-id.
         */
        async function resolveWithResponse(verb: string, xmlContent: string, status = '200'): Promise<void> {
            await flushMicrotasks();
            fakeWebSocket.emit('open');
            fakeWebSocket.emit('message', buildEcp2ResponseFrame(fakeWebSocket, verb, xmlContent, status));
        }

        it('performs the full happy path for launch: open, send, message, resolved content', async () => {
            const device = createDevice();

            const responsePromise = device.launch('dev');
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/ecp2/auth-proxy');
            expect(capturedWebSocketOptions.headers).to.eql({ Authorization: 'Bearer secret' });

            fakeWebSocket.emit('open');
            const sentRequest = lastSentRequest(fakeWebSocket);
            expect(sentRequest).to.include({ request: 'launch', 'param-channel-id': 'dev' });

            fakeWebSocket.emit('message', buildEcp2ResponseFrame(fakeWebSocket, 'launch', '<launch-response/>'));
            const response = await responsePromise;

            expect(response.response).to.equal('launch');
            expect(response.status).to.equal(200);
            expect(response.content).to.equal('<launch-response/>');
        });

        it('queryApps sends the bare query-apps verb with no params', async () => {
            const device = createDevice();
            const responsePromise = device.queryApps();
            await resolveWithResponse('query-apps', '<apps><app id="dev" type="appl" subtype="sdka" version="1.0.0">Dev Channel</app></apps>');
            const response = await responsePromise;

            const sentRequest = lastSentRequest(fakeWebSocket);
            expect(sentRequest.request).to.equal('query-apps');
            expect(Object.keys(sentRequest)).to.eql(['request', 'request-id']);
            expect(response.content).to.equal('<apps><app id="dev" type="appl" subtype="sdka" version="1.0.0">Dev Channel</app></apps>');
        });

        it('queryActiveApp sends the bare query-active-app verb with no params', async () => {
            const device = createDevice();
            const responsePromise = device.queryActiveApp();
            await resolveWithResponse('query-active-app', '<active-app><app id="dev">Dev Channel</app></active-app>');
            const response = await responsePromise;

            const sentRequest = lastSentRequest(fakeWebSocket);
            expect(sentRequest.request).to.equal('query-active-app');
            expect(Object.keys(sentRequest)).to.eql(['request', 'request-id']);
            expect(response.content).to.equal('<active-app><app id="dev">Dev Channel</app></active-app>');
        });

        it('queryAppState sends the query-app-state verb with param-channel-id', async () => {
            const device = createDevice();
            const responsePromise = device.queryAppState('dev');
            await resolveWithResponse('query-app-state', '<app-state>active</app-state>');
            const response = await responsePromise;

            expect(lastSentRequest(fakeWebSocket)).to.include({ request: 'query-app-state', 'param-channel-id': 'dev' });
            expect(response.content).to.equal('<app-state>active</app-state>');
        });

        it('exitApp sends the exit-app verb with param-channel-id', async () => {
            const device = createDevice();
            const responsePromise = device.exitApp('dev');
            await resolveWithResponse('exit-app', '<exit-response/>');
            const response = await responsePromise;

            expect(lastSentRequest(fakeWebSocket)).to.include({ request: 'exit-app', 'param-channel-id': 'dev' });
            expect(response.content).to.equal('<exit-response/>');
        });

        it('queryRegistry sends the query-registry verb with param-id, not param-channel-id', async () => {
            const device = createDevice();
            const responsePromise = device.queryRegistry('dev');
            await resolveWithResponse('query-registry', '<registry/>');
            const response = await responsePromise;

            const sentRequest = lastSentRequest(fakeWebSocket);
            expect(sentRequest).to.include({ request: 'query-registry', 'param-id': 'dev' });
            expect(sentRequest).to.not.have.property('param-channel-id');
            expect(sentRequest).to.not.have.property('param-app-id');
            expect(response.content).to.equal('<registry/>');
        });

        it('queryRendezvous sends the bare query-sgrendezvous verb with no params', async () => {
            const device = createDevice();
            const responsePromise = device.queryRendezvous();
            await resolveWithResponse('query-sgrendezvous', '<rendezvous/>');
            const response = await responsePromise;

            const sentRequest = lastSentRequest(fakeWebSocket);
            expect(sentRequest.request).to.equal('query-sgrendezvous');
            expect(Object.keys(sentRequest)).to.eql(['request', 'request-id']);
            expect(response.content).to.equal('<rendezvous/>');
        });

        it('setRendezvousTracking(true) sends the sgrendezvous verb with param-track set to track', async () => {
            const device = createDevice();
            const responsePromise = device.setRendezvousTracking(true);
            await resolveWithResponse('sgrendezvous', '');

            expect(lastSentRequest(fakeWebSocket)).to.include({ request: 'sgrendezvous', 'param-track': 'track' });
            await responsePromise;
        });

        it('setRendezvousTracking(false) sends the sgrendezvous verb with param-track set to untrack', async () => {
            const device = createDevice();
            const responsePromise = device.setRendezvousTracking(false);
            await resolveWithResponse('sgrendezvous', '');

            expect(lastSentRequest(fakeWebSocket)).to.include({ request: 'sgrendezvous', 'param-track': 'untrack' });
            await responsePromise;
        });
    });
});
