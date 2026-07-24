import { expect } from 'chai';
import * as sinonImport from 'sinon';
import { EventEmitter } from 'events';
import type * as WebSocket from 'ws';
import { RceVideoSignalingClient } from './RceVideoSignalingClient';
import type { RceVideoSignalingConfig } from './RceVideoSignalingClient';

let sinon: sinonImport.SinonSandbox;
beforeEach(() => {
    sinon = sinonImport.createSandbox();
});
afterEach(() => {
    sinon.restore();
});

/**
 * Lets any pending microtasks (chained promise callbacks from the negotiation sequence) settle
 * before assertions run
 */
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

/**
 * Waits a real number of milliseconds, for tests that need a real timer (keepalive, negotiation
 * timeout) to fire rather than fighting fake timers against the microtask flushing above.
 */
function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * Minimal fake standing in for a real `ws` socket. A real `ws` socket is itself an EventEmitter
 * (`on('open'|'message'|'error'|'close', ...)`), unlike a browser WebSocket's `onX` properties, so
 * extending Node's EventEmitter directly gives correct on/once/removeAllListeners/emit semantics.
 */
class FakeWebSocket extends EventEmitter {
    //mirrors ws's real readyState constants (also what RceVideoSignalingClient compares against)
    public static readonly CONNECTING = 0;

    public static readonly OPEN = 1;

    public static readonly CLOSED = 3;

    public sentMessages: Array<Record<string, any>> = [];

    public closed = false;

    public terminated = false;

    public readyState: number = FakeWebSocket.CONNECTING;

    /**
     * When true, close()/terminate() reproduce ws's real behavior of emitting an 'error' when a
     * still-CONNECTING socket is closed ("WebSocket was closed before the connection was established")
     */
    public emitErrorOnCloseWhileConnecting = false;

    public send(data: string) {
        this.sentMessages.push(JSON.parse(data));
    }

    //real ws transitions readyState to OPEN right before emitting 'open'; mirror that here so every
    //call site's plain `fakeWebSocket.emit('open')` reflects the state RceVideoSignalingClient sees
    public emit(event: string | symbol, ...args: any[]): boolean {
        if (event === 'open') {
            this.readyState = FakeWebSocket.OPEN;
        }
        return super.emit(event, ...args);
    }

    public close() {
        this.closed = true;
        this.simulateCloseWhileConnectingError();
        this.readyState = FakeWebSocket.CLOSED;
    }

    public terminate() {
        this.terminated = true;
        this.simulateCloseWhileConnectingError();
        this.readyState = FakeWebSocket.CLOSED;
    }

    private simulateCloseWhileConnectingError() {
        if (this.emitErrorOnCloseWhileConnecting && this.readyState === FakeWebSocket.CONNECTING) {
            this.emit('error', new Error('WebSocket was closed before the connection was established'));
        }
    }
}

function createConfig(overrides: Partial<RceVideoSignalingConfig> = {}): RceVideoSignalingConfig {
    return {
        websocketUrl: 'wss://device.rce.roku.com/instance/abc/janus',
        streamId: 42,
        apiToken: 'management-api-token',
        iceServers: [{ urls: ['stun:stun.example.com'] }],
        ...overrides
    };
}

describe('RceVideoSignalingClient', () => {
    let fakeWebSocket: FakeWebSocket;
    let capturedWebSocketOptions: WebSocket.ClientOptions | undefined;
    //every client created via createClient(), so afterEach can stop() each one: this is a Node test
    //environment, and a real setInterval left running (the keepalive timer) keeps the process alive
    //indefinitely, hanging the whole mocha run rather than just this file
    let createdClients: RceVideoSignalingClient[] = [];

    afterEach(() => {
        for (const createdClient of createdClients) {
            createdClient.stop();
        }
        createdClients = [];
    });

    function createClient(configOverrides: Partial<RceVideoSignalingConfig> = {}, keepaliveIntervalMs?: number, negotiationTimeoutMs?: number): RceVideoSignalingClient {
        fakeWebSocket = new FakeWebSocket();
        capturedWebSocketOptions = undefined;
        const client = new RceVideoSignalingClient(createConfig(configOverrides), {
            createWebSocket: (url, requestOptions) => {
                capturedWebSocketOptions = requestOptions;
                return fakeWebSocket as unknown as WebSocket;
            },
            keepaliveIntervalMs: keepaliveIntervalMs,
            negotiationTimeoutMs: negotiationTimeoutMs
        });
        createdClients.push(client);
        return client;
    }

    function findSentRequest(janusType: string, requestIndex = 0): Record<string, any> {
        const matches = fakeWebSocket.sentMessages.filter((message) => message.janus === janusType);
        return matches[requestIndex];
    }

    function simulateMessage(message: Record<string, any>) {
        fakeWebSocket.emit('message', Buffer.from(JSON.stringify(message)));
    }

    /**
     * Drives a client through create -> attach -> watch, resolving connect() with the offer.
     * Returns the sent requests for callers that want to make additional assertions on them.
     */
    async function connectToOfferState(client: RceVideoSignalingClient) {
        const connectPromise = client.connect();

        fakeWebSocket.emit('open');
        await flushMicrotasks();
        const createRequest = findSentRequest('create');
        simulateMessage({ janus: 'success', transaction: createRequest.transaction, data: { id: 111 } });
        await flushMicrotasks();

        const attachRequest = findSentRequest('attach');
        simulateMessage({ janus: 'success', transaction: attachRequest.transaction, data: { id: 222 } });
        await flushMicrotasks();

        const watchRequest = findSentRequest('message', 0);
        simulateMessage({
            janus: 'event',
            transaction: watchRequest.transaction,
            jsep: { type: 'offer', sdp: 'v=0\r\no=- offer-sdp\r\n' }
        });

        const offer = await connectPromise;

        return { offer: offer, createRequest: createRequest, attachRequest: attachRequest, watchRequest: watchRequest };
    }

    describe('connect', () => {
        it('negotiates the create -> attach -> watch sequence and resolves with the offer and ice servers', async () => {
            const client = createClient();

            const { createRequest, attachRequest, watchRequest, offer } = await connectToOfferState(client);

            expect(createRequest.janus).to.equal('create');

            expect(attachRequest.session_id).to.equal(111);
            expect(attachRequest.plugin).to.equal('janus.plugin.streaming');

            expect(watchRequest.session_id).to.equal(111);
            expect(watchRequest.handle_id).to.equal(222);
            expect(watchRequest.body).to.eql({ request: 'watch', id: 42 });

            expect(offer.offer).to.eql({ type: 'offer', sdp: 'v=0\r\no=- offer-sdp\r\n' });
            expect(offer.iceServers).to.eql([{ urls: ['stun:stun.example.com'] }]);
        });

        it('passes the api token as an Authorization bearer header on the websocket handshake', () => {
            const client = createClient({ apiToken: 'secret-management-token' });

            void client.connect();

            expect(capturedWebSocketOptions.headers).to.eql({ Authorization: 'Bearer secret-management-token' });
        });

        it('includes the pin in the watch request when configured', async () => {
            const client = createClient({ pin: '1234' });
            const { watchRequest } = await connectToOfferState(client);

            expect(watchRequest.body).to.eql({ request: 'watch', id: 42, pin: '1234' });
        });

        it('keeps a stream id of 0 in the watch request rather than treating it as missing', async () => {
            const client = createClient({ streamId: 0 });
            const { watchRequest } = await connectToOfferState(client);

            expect(watchRequest.body).to.eql({ request: 'watch', id: 0 });
        });

        it('sends the janus token as apisecret (not token) on every request when one is configured', async () => {
            const client = createClient({ janusToken: 'janus-secret' });
            await connectToOfferState(client);

            for (const sentMessage of fakeWebSocket.sentMessages) {
                expect(sentMessage.apisecret).to.equal('janus-secret');
                expect(sentMessage.token).to.be.undefined;
            }
        });

        it('omits the apisecret field when no janus token is configured', async () => {
            const client = createClient();
            await connectToOfferState(client);

            for (const sentMessage of fakeWebSocket.sentMessages) {
                expect(sentMessage.apisecret).to.be.undefined;
            }
        });
    });

    describe('sendAnswer', () => {
        it('sends the start request with the given jsep and resolves when janus answers', async () => {
            const client = createClient();
            await connectToOfferState(client);

            const answerPromise = client.sendAnswer({ type: 'answer', sdp: 'v=0\r\no=- answer-sdp\r\n' });

            const startRequest = findSentRequest('message', 1);
            expect(startRequest.session_id).to.equal(111);
            expect(startRequest.handle_id).to.equal(222);
            expect(startRequest.body).to.eql({ request: 'start' });
            expect(startRequest.jsep).to.eql({ type: 'answer', sdp: 'v=0\r\no=- answer-sdp\r\n' });

            simulateMessage({ janus: 'event', transaction: startRequest.transaction });

            await answerPromise;
        });
    });

    describe('trickle ICE', () => {
        it('sendCandidate sends a trickle request carrying the given candidate', async () => {
            const client = createClient();
            await connectToOfferState(client);

            const fakeCandidate = { candidate: 'candidate:1 1 UDP 1 1.2.3.4 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
            client.sendCandidate(fakeCandidate);

            const trickleRequest = findSentRequest('trickle', 0);
            expect(trickleRequest.session_id).to.equal(111);
            expect(trickleRequest.handle_id).to.equal(222);
            expect(trickleRequest.candidate).to.eql(fakeCandidate);
        });

        it('sendCandidatesComplete sends a completed trickle request', async () => {
            const client = createClient();
            await connectToOfferState(client);

            client.sendCandidatesComplete();

            const completedRequest = findSentRequest('trickle', 0);
            expect(completedRequest.candidate).to.eql({ completed: true });
        });
    });

    describe('keepalive', () => {
        //fake timers fight the real setImmediate-driven microtask flushing the negotiation sequence
        //needs, so this uses a short real interval and a real short wait rather than sinon.useFakeTimers()
        it('sends a keepalive on the configured interval once connected', async () => {
            const client = createClient({}, 15);
            await connectToOfferState(client);

            await wait(60);

            const keepaliveRequest = findSentRequest('keepalive');
            expect(keepaliveRequest).to.exist;
            expect(keepaliveRequest.session_id).to.equal(111);
        });

        it('stops sending keepalives after stop()', async () => {
            const client = createClient({}, 15);
            await connectToOfferState(client);

            client.stop();
            const keepaliveCountAtStop = fakeWebSocket.sentMessages.filter((message) => message.janus === 'keepalive').length;

            await wait(60);

            const keepaliveCountAfterWaiting = fakeWebSocket.sentMessages.filter((message) => message.janus === 'keepalive').length;
            expect(keepaliveCountAfterWaiting).to.equal(keepaliveCountAtStop);
        });
    });

    describe('errors', () => {
        it('rejects connect() when a janus error answers a pending request', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            const createRequest = findSentRequest('create');
            simulateMessage({
                janus: 'error',
                transaction: createRequest.transaction,
                error: { code: 490, reason: 'Session not found' }
            });

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('Session not found');
        });

        it('emits an error event for a janus error not tied to a pending request', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let emittedError: Error | undefined;
            client.on('error', (error) => {
                emittedError = error;
            });

            simulateMessage({
                janus: 'error',
                error: { code: 458, reason: 'Unauthorized request' }
            });

            expect(emittedError?.message).to.contain('Unauthorized request');
        });

        it('emits an error event on hangup', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let emittedError: Error | undefined;
            client.on('error', (error) => {
                emittedError = error;
            });

            simulateMessage({ janus: 'hangup', reason: 'Remote WebRTC hangup' });

            expect(emittedError?.message).to.contain('Remote WebRTC hangup');
        });

        it('rejects connect() with the plugin error text when watch is answered with a plugindata error instead of an offer', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: findSentRequest('create').transaction, data: { id: 111 } });
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: findSentRequest('attach').transaction, data: { id: 222 } });
            await flushMicrotasks();

            const watchRequest = findSentRequest('message', 0);
            simulateMessage({
                janus: 'event',
                transaction: watchRequest.transaction,
                plugindata: { data: { error_code: 456, error: 'Invalid PIN' } }
            });

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('Invalid PIN');
            expect(caughtError?.message).to.contain('456');
        });
    });

    describe('close', () => {
        it('emits a close event when the socket closes', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let closeEmitted = false;
            client.on('close', () => {
                closeEmitted = true;
            });

            fakeWebSocket.emit('close');

            expect(closeEmitted).to.be.true;
        });
    });

    describe('negotiation timeout', () => {
        it('rejects connect() and closes the socket when the gateway never responds', async () => {
            const client = createClient({}, undefined, 15);
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            //never answer the 'create' request

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.contain('Timed out');
            expect(fakeWebSocket.closed).to.be.true;
        });

        it('does not time out once negotiation completes before the deadline', async () => {
            const client = createClient({}, undefined, 2000);
            await connectToOfferState(client);

            //give the (already-cleared) timeout a chance to fire if it were not actually cleared
            await wait(30);

            expect(fakeWebSocket.closed).to.be.false;
        });
    });

    describe('stop', () => {
        it('destroys the session and closes the socket', async () => {
            const client = createClient();
            await connectToOfferState(client);

            client.stop();

            const destroyRequest = findSentRequest('destroy');
            expect(destroyRequest.session_id).to.equal(111);
            expect(fakeWebSocket.closed).to.be.true;
        });

        it('is safe to call before connect() has finished', () => {
            const client = createClient();
            void client.connect();

            expect(() => client.stop()).not.to.throw();
        });

        it('is safe to call more than once', async () => {
            const client = createClient();
            await connectToOfferState(client);

            client.stop();

            expect(() => client.stop()).not.to.throw();
        });

        it('swallows the "closed before connection established" error when stopping a still-CONNECTING socket, without emitting it', () => {
            const client = createClient({}, undefined, 15);
            fakeWebSocket.emitErrorOnCloseWhileConnecting = true;
            //never resolves/rejects in a way this test cares about; caught so the eventual
            //negotiation-timeout rejection (the socket never gets a chance to open) is not an
            //unhandled rejection
            client.connect().catch(() => { });

            let emittedError: Error | undefined;
            let emittedClose = false;
            client.on('error', (error) => {
                emittedError = error;
            });
            client.on('close', () => {
                emittedClose = true;
            });

            expect(() => client.stop()).not.to.throw();

            expect(fakeWebSocket.terminated).to.be.true;
            expect(fakeWebSocket.closed).to.be.false;
            expect(emittedError).to.be.undefined;
            expect(emittedClose).to.be.false;
        });
    });
});
