import { expect } from 'chai';
import * as sinonImport from 'sinon';
import { EventEmitter } from 'events';
import type * as WebSocket from 'ws';
import * as ws from 'ws';
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
            keepaliveIntervalMs: keepaliveIntervalMs,
            negotiationTimeoutMs: negotiationTimeoutMs
        });
        //a fresh fake per websocket, so a reconnect (a second createWebSocket call) gets its own
        //socket exactly like the real method would; `fakeWebSocket` always points at the latest
        sinon.stub(client as any, 'createWebSocket').callsFake((url, requestOptions) => {
            fakeWebSocket = new FakeWebSocket();
            capturedWebSocketOptions = requestOptions as WebSocket.ClientOptions;
            return fakeWebSocket as unknown as WebSocket;
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

            //never driven to completion; the afterEach stop() rejects it, so absorb that rejection
            client.connect().catch(() => { });

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

    describe('connect() reuse guards', () => {
        it('rejects a second connect() while a session is already active', async () => {
            const client = createClient();
            //never driven to completion; the afterEach stop() rejects it, so absorb that rejection
            client.connect().catch(() => { });

            let caughtError: Error;
            try {
                await client.connect();
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('already connected or connecting; call stop() before reconnecting');
        });

        it('allows connect() again after stop()', () => {
            const client = createClient();
            client.connect().catch(() => { });
            const firstFakeWebSocket = fakeWebSocket;

            client.stop();
            client.connect().catch(() => { });

            //the second connect() got past the guard and opened a fresh websocket
            expect(fakeWebSocket).to.not.equal(firstFakeWebSocket);
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

        it('rejects an in-flight request when the socket closes unexpectedly, instead of hanging its caller', async () => {
            const client = createClient();
            await connectToOfferState(client);

            const answerPromise = client.sendAnswer({ type: 'answer', sdp: 'v=0\r\no=- answer-sdp\r\n' });
            fakeWebSocket.emit('close');

            let caughtError: Error;
            try {
                await answerPromise;
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain(`The Janus WebSocket for stream '42' closed unexpectedly`);
        });

        it('rejects a request sent after an unexpected close, instead of silently dropping it', async () => {
            const client = createClient();
            await connectToOfferState(client);

            fakeWebSocket.emit('close');

            let caughtError: Error;
            try {
                await client.sendAnswer({ type: 'answer', sdp: 'v=0\r\no=- answer-sdp\r\n' });
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('the signaling session is not connected');
        });
    });

    describe('connect failure cleanup', () => {
        it('stops the keepalive and closes the socket when negotiation fails after the session was created', async () => {
            //short real keepalive interval, so a leaked timer would be caught by the wait below
            const client = createClient({}, 15);
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: findSentRequest('create').transaction, data: { id: 111 } });
            await flushMicrotasks();
            //the keepalive is running now (it starts once the session is created); fail the attach
            simulateMessage({
                janus: 'error',
                transaction: findSentRequest('attach').transaction,
                error: { code: 458, reason: 'attach failed' }
            });

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain('attach failed');
            expect(fakeWebSocket.closed).to.be.true;

            const keepaliveCountAtFailure = fakeWebSocket.sentMessages.filter((message) => message.janus === 'keepalive').length;
            await wait(60);
            const keepaliveCountAfterWaiting = fakeWebSocket.sentMessages.filter((message) => message.janus === 'keepalive').length;
            expect(keepaliveCountAfterWaiting).to.equal(keepaliveCountAtFailure);
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

        it('a timeout that fires after negotiation already settled does nothing', async () => {
            //capture the negotiation timer's callback so the timer-fired-late race (normally
            //prevented by clearTimeout) can be forced deterministically
            let timeoutCallback: (() => void) | undefined;
            const setTimeoutStub = sinon.stub(global, 'setTimeout').callsFake(((callback: () => void) => {
                timeoutCallback = callback;
                return {} as any;
            }) as any);
            try {
                const client = createClient();
                await connectToOfferState(client);

                let emittedError: Error | undefined;
                client.on('error', (error) => {
                    emittedError = error;
                });
                timeoutCallback();

                expect(emittedError).to.be.undefined;
                expect(fakeWebSocket.closed).to.be.false;
            } finally {
                setTimeoutStub.restore();
            }
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

        it('is safe to call before connect() has finished, rejecting that connect() immediately', async () => {
            //the default 20s negotiation timeout proves connect() settles from stop() itself: if it
            //waited for the timeout instead, this test would take 20s and fail mocha's time limit
            const client = createClient();
            const connectPromise = client.connect();

            expect(() => client.stop()).not.to.throw();

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }
            expect(caughtError?.message).to.contain(`Janus signaling session for stream '42' was stopped`);
        });

        it('is safe to call more than once', async () => {
            const client = createClient();
            await connectToOfferState(client);

            client.stop();

            expect(() => client.stop()).not.to.throw();
        });

        it('fire-and-forget sends after stop() are dropped instead of throwing', async () => {
            const client = createClient();
            await connectToOfferState(client);
            client.stop();

            expect(() => client.sendCandidatesComplete()).not.to.throw();
        });

        it('applies the default keepalive and negotiation timings when constructed without options', () => {
            const client = new RceVideoSignalingClient(createConfig());
            createdClients.push(client);

            expect((client as any).keepaliveIntervalMs).to.equal(25000);
            expect((client as any).negotiationTimeoutMs).to.equal(20000);
        });

        it('creates a real ws websocket speaking the janus protocol outside of tests (every other test stubs the factory)', () => {
            const client = new RceVideoSignalingClient(createConfig());
            createdClients.push(client);
            const webSocket = (client as any).createWebSocket('ws://127.0.0.1:1', {}) as ws.WebSocket;

            expect(webSocket).to.be.instanceOf(ws.WebSocket);

            //the connection attempt targets a closed port; silence and abort it
            webSocket.on('error', () => { });
            webSocket.terminate();
        });

        it('rejects connect() when the websocket handshake fails', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('error', new Error('handshake refused'));

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.equal('Failed to connect to the Janus WebSocket: handshake refused');
        });

        it('rejects connect() when the websocket closes before it ever opens', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('close');

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.equal(`The Janus WebSocket for stream '42' closed unexpectedly`);
        });

        it('emits an error event for a websocket error after the session is established', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let emittedError: Error | undefined;
            client.on('error', (error) => {
                emittedError = error;
            });
            fakeWebSocket.emit('error', new Error('mid-session failure'));

            expect(emittedError?.message).to.equal('Janus WebSocket error: mid-session failure');
        });

        it('rejects connect() when the watch response carries no SDP offer, tolerating create/attach responses with no data', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            //create and attach answered without a data block: the session/handle ids are simply undefined
            simulateMessage({ janus: 'success', transaction: findSentRequest('create').transaction });
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: findSentRequest('attach').transaction });
            await flushMicrotasks();
            //watch answered without a jsep offer
            simulateMessage({ janus: 'event', transaction: findSentRequest('message', 0).transaction });

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.equal(`Janus did not return an SDP offer for stream '42'`);
        });

        it('defaults to no ice servers when the config carries none', async () => {
            const client = createClient({ iceServers: undefined });

            const { offer } = await connectToOfferState(client);

            expect(offer.iceServers).to.eql([]);
        });

        it('ignores a message that is not valid json', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let emittedError: Error | undefined;
            client.on('error', (error) => {
                emittedError = error;
            });
            fakeWebSocket.emit('message', Buffer.from('this is not json'));

            expect(emittedError).to.be.undefined;
        });

        it('ignores the ack that precedes an asynchronous response, settling on the real response', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            const createTransaction = findSentRequest('create').transaction;
            //janus acknowledges the request first, then answers it for real
            simulateMessage({ janus: 'ack', transaction: createTransaction });
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: createTransaction, data: { id: 111 } });
            await flushMicrotasks();

            simulateMessage({ janus: 'success', transaction: findSentRequest('attach').transaction, data: { id: 222 } });
            await flushMicrotasks();
            simulateMessage({
                janus: 'event',
                transaction: findSentRequest('message', 0).transaction,
                jsep: { type: 'offer', sdp: 'v=0\r\n' }
            });

            const offer = await connectPromise;
            expect(offer.offer.sdp).to.equal('v=0\r\n');
        });

        it('emits an error event for a janus error whose transaction matches no pending request', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let emittedError: Error | undefined;
            client.on('error', (error) => {
                emittedError = error;
            });
            simulateMessage({ janus: 'error', transaction: 'no-such-transaction', error: { code: 458, reason: 'Session not found' } });

            expect(emittedError?.message).to.equal(`Janus error for stream '42' (code 458): Session not found`);
        });

        it('describes a janus error that carries no error details as an unknown error', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            simulateMessage({ janus: 'error', transaction: findSentRequest('create').transaction });

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.equal(`Janus error for stream '42': unknown error`);
        });

        it('describes a plugin error that carries no error code without a code suffix', async () => {
            const client = createClient();
            const connectPromise = client.connect();

            fakeWebSocket.emit('open');
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: findSentRequest('create').transaction, data: { id: 111 } });
            await flushMicrotasks();
            simulateMessage({ janus: 'success', transaction: findSentRequest('attach').transaction, data: { id: 222 } });
            await flushMicrotasks();
            simulateMessage({
                janus: 'event',
                transaction: findSentRequest('message', 0).transaction,
                plugindata: { data: { error: 'Wrong pin' } }
            });

            let caughtError: Error;
            try {
                await connectPromise;
            } catch (error) {
                caughtError = error as Error;
            }

            expect(caughtError?.message).to.equal(`Janus plugin error for stream '42': Wrong pin`);
        });

        it('describes a hangup that carries no reason without a reason suffix', async () => {
            const client = createClient();
            await connectToOfferState(client);

            let emittedError: Error | undefined;
            client.on('error', (error) => {
                emittedError = error;
            });
            simulateMessage({ janus: 'hangup' });

            expect(emittedError?.message).to.equal(`Janus hung up on stream '42'`);
        });

        it('swallows the "closed before connection established" error when stopping a still-CONNECTING socket, without emitting it', () => {
            const client = createClient({}, undefined, 15);
            //never resolves/rejects in a way this test cares about; caught so the eventual
            //negotiation-timeout rejection (the socket never gets a chance to open) is not an
            //unhandled rejection
            client.connect().catch(() => { });
            //the flag must be set on the socket connect() actually created (createWebSocket makes a
            //fresh fake per call), otherwise the close-while-connecting error is never simulated
            fakeWebSocket.emitErrorOnCloseWhileConnecting = true;

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
