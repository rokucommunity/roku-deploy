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
    public sentFrames: string[] = [];

    public closed = false;

    public send(data: string): void {
        this.sentFrames.push(data);
    }

    public close(): void {
        this.closed = true;
    }
}

/**
 * Parses the JSON frame most recently sent by a fake websocket (the ECP2 request).
 */
function lastSentRequest(fakeWebSocket: FakeWebSocket): Record<string, string> {
    return JSON.parse(fakeWebSocket.sentFrames[fakeWebSocket.sentFrames.length - 1]);
}

/**
 * Builds a status-only ECP2 response frame echoing the request-id from whatever the fake websocket
 * most recently sent, so the response correlates with sendEcp2Request's `response-id` matching.
 */
function buildEcp2StatusFrame(fakeWebSocket: FakeWebSocket, status: string, statusMessage = 'OK'): string {
    const sentRequest = lastSentRequest(fakeWebSocket);
    return JSON.stringify({
        response: sentRequest.request,
        'response-id': sentRequest['request-id'],
        status: status,
        'status-msg': statusMessage
    });
}

describe('RceDevice', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('sendKeySequence', () => {
        let createdSockets: FakeWebSocket[];
        let createdUrls: string[];
        let createdHeaders: Array<Record<string, string>>;

        function createDevice() {
            createdSockets = [];
            createdUrls = [];
            createdHeaders = [];
            return new RceDevice(
                { instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'secret' },
                {
                    createWebSocket: (url, requestOptions) => {
                        const fakeWebSocket = new FakeWebSocket();
                        createdSockets.push(fakeWebSocket);
                        createdUrls.push(url);
                        createdHeaders.push(requestOptions.headers as Record<string, string>);
                        //open on the next tick, like a real socket, so the caller's listeners are attached
                        setImmediate(() => fakeWebSocket.emit('open'));
                        return fakeWebSocket as unknown as WebSocket;
                    }
                }
            );
        }

        /**
         * Answers each key press's request frame with the given status as soon as it is sent, so a
         * whole sequence plays through without manual pumping.
         */
        function autoRespond(status: string) {
            const answered = new Set<FakeWebSocket>();
            const timer = setInterval(() => {
                for (const fakeWebSocket of createdSockets) {
                    if (!answered.has(fakeWebSocket) && fakeWebSocket.sentFrames.length > 0) {
                        answered.add(fakeWebSocket);
                        fakeWebSocket.emit('message', buildEcp2StatusFrame(fakeWebSocket, status));
                    }
                }
            }, 1);
            return () => clearInterval(timer);
        }

        it('presses every key in order over the ecp2 auth-proxy websocket with bearer auth', async () => {
            const device = createDevice();
            const stopResponding = autoRespond('200');

            await device.sendKeySequence(['Home', 'Up', 'Select'], { keyDelayMs: 0 });
            stopResponding();

            expect(createdSockets.length).to.equal(3);
            expect(createdUrls[0]).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/ecp2/auth-proxy');
            expect(createdHeaders[0]).to.eql({ Authorization: 'Bearer secret' });
            const sentKeys = createdSockets.map((fakeWebSocket) => lastSentRequest(fakeWebSocket));
            expect(sentKeys.map((frame) => frame.request)).to.eql(['key-press', 'key-press', 'key-press']);
            expect(sentKeys.map((frame) => frame['param-key'])).to.eql(['Home', 'Up', 'Select']);
            //each request's socket is closed once its response arrives
            expect(createdSockets.every((fakeWebSocket) => fakeWebSocket.closed)).to.be.true;
        });

        it('accepts a 202 (accepted key event) as success', async () => {
            const device = createDevice();
            const stopResponding = autoRespond('202');

            await device.sendKeySequence(['Home'], { keyDelayMs: 0 });
            stopResponding();

            expect(createdSockets.length).to.equal(1);
        });

        it('stops at the first non-2xx response with the failing key and step in the error', async () => {
            const device = createDevice();
            const stopResponding = autoRespond('403');

            let caughtError: Error;
            try {
                await device.sendKeySequence(['Home', 'Up'], { keyDelayMs: 0 });
            } catch (error) {
                caughtError = error as Error;
            }
            stopResponding();

            expect(caughtError?.message).to.contain(`Key press 'Home'`);
            expect(caughtError?.message).to.contain('step 1 of 2');
            expect(caughtError?.message).to.contain('403');
            //the second key was never sent
            expect(createdSockets.length).to.equal(1);
        });

        it('ignores notify frames (the auth challenge) while waiting for the response', async () => {
            const device = createDevice();
            const sequencePromise = device.sendKeySequence(['Home'], { keyDelayMs: 0 });

            //wait for the socket to open and the request frame to be sent
            while (createdSockets[0]?.sentFrames.length !== 1) {
                await new Promise((resolve) => {
                    setImmediate(resolve);
                });
            }
            const fakeWebSocket = createdSockets[0];
            fakeWebSocket.emit('message', JSON.stringify({ notify: 'authenticate' }));
            fakeWebSocket.emit('message', buildEcp2StatusFrame(fakeWebSocket, '200'));

            await sequencePromise;
            expect(fakeWebSocket.closed).to.be.true;
        });

        it('rejects when the socket closes before a response arrives', async () => {
            const device = createDevice();
            const sequencePromise = device.sendKeySequence(['Home'], { keyDelayMs: 0 });

            await new Promise((resolve) => {
                setImmediate(resolve);
            });
            createdSockets[0].emit('close');

            let caughtError: Error;
            try {
                await sequencePromise;
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('closed before a response');
        });
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
