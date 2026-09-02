import { expect } from 'chai';
import * as sinonImport from 'sinon';
import * as net from 'net';
import { EventEmitter } from 'events';
import type * as WebSocket from 'ws';
import * as ws from 'ws';
import { createRokuDeploySocket } from './RokuDeploySocket';
import type { RokuDeploySocket, SocketOptions } from './RokuDeploySocket';
import { RceManagementClient } from './RceManagementClient';

let sinon: sinonImport.SinonSandbox;
beforeEach(() => {
    sinon = sinonImport.createSandbox();
});
afterEach(() => {
    sinon.restore();
});

/**
 * Lets any pending microtasks (the getInstanceUrl() await inside the RCE connect sequence) settle
 * before assertions run.
 */
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

/**
 * Waits a real number of milliseconds, for the setTimeout idle-timeout tests, which need a real
 * timer rather than fighting fake timers against the microtask flushing above.
 */
function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * Minimal fake standing in for a real `ws` socket. A real `ws` socket is itself an EventEmitter
 * (`on('open'|'message'|'error'|'close', ...)`), so extending Node's EventEmitter directly gives
 * correct on/once/removeAllListeners/emit semantics.
 */
class FakeWebSocket extends EventEmitter {
    //mirrors ws's real readyState constants (also what RceTelnetSocket compares against)
    public static readonly CONNECTING = 0;

    public static readonly OPEN = 1;

    public static readonly CLOSED = 3;

    public sentFrames: Array<{ data: any; options: any }> = [];

    public closed = false;

    public terminated = false;

    public readyState: number = FakeWebSocket.CONNECTING;

    public paused = false;

    //mirrors ws's isPaused getter, which RceSocket's _read checks before resuming
    public get isPaused(): boolean {
        return this.paused;
    }

    public pause(): void {
        this.paused = true;
    }

    public resume(): void {
        this.paused = false;
    }

    public send(data: any, options: any, callback?: (error?: Error) => void): void {
        this.sentFrames.push({ data: data, options: options });
        callback?.();
    }

    //real ws transitions readyState to OPEN right before emitting 'open'; mirror that here so every
    //call site's plain `fakeWebSocket.emit('open')` reflects the state RceTelnetSocket sees
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

    public terminate(): void {
        this.terminated = true;
        this.readyState = FakeWebSocket.CLOSED;
    }
}

describe('createRokuDeploySocket', () => {
    it('throws when given a registry name string instead of a device config', () => {
        expect(() => createRokuDeploySocket({ device: 'my-device' as any, port: 8085 })).to.throw('Device registry names are not supported');
    });

    it('throws when given a device config with no recognized identifier', () => {
        expect(() => createRokuDeploySocket({ device: {} as any, port: 8085 })).to.throw('Device config must specify exactly one targeting identifier: host, esn, id, or instanceUrl');
    });

    it('throws when given a device config with multiple identifiers', () => {
        expect(() => createRokuDeploySocket({ device: { host: '1.2.3.4', esn: 'ABC123' } as any, port: 8085 })).to.throw('Device config specifies multiple targeting identifiers (host, esn); exactly one of host, esn, id, or instanceUrl is allowed');
    });

    describe('local device', () => {
        let connectedArguments: Array<{ port: number; host: string }>;

        /**
         * Stubs net.Socket's real connect() so these tests can assert what port/host
         * LocalTelnetSocket resolves without opening an actual socket.
         */
        function stubRealSocketConnect(): void {
            connectedArguments = [];
            sinon.stub(net.Socket.prototype, 'connect').callsFake(function fakeConnect(this: net.Socket, port: number, host: string) {
                connectedArguments.push({ port: port, host: host });
                return this;
            } as any);
        }

        it('connects to the given port', () => {
            stubRealSocketConnect();
            createRokuDeploySocket({ device: { host: '1.2.3.4' }, port: 8085 }).connect();
            expect(connectedArguments).to.eql([{ port: 8085, host: '1.2.3.4' }]);
        });

        it('delegates an explicit-address connect() call to net.Socket unchanged', () => {
            stubRealSocketConnect();
            (createRokuDeploySocket({ device: { host: '1.2.3.4' }, port: 8085 }) as unknown as net.Socket).connect(9000, '5.6.7.8');
            expect(connectedArguments).to.eql([{ port: 9000, host: '5.6.7.8' }]);
        });

        it('throws when the port is missing or invalid', () => {
            expect(() => createRokuDeploySocket({ device: { host: '1.2.3.4' } } as any)).to.throw('requires a valid port number');
            expect(() => createRokuDeploySocket({ device: { host: '1.2.3.4' }, port: 0 })).to.throw('requires a valid port number');
            expect(() => createRokuDeploySocket({ device: { host: '1.2.3.4' }, port: 8085.5 })).to.throw('requires a valid port number');
        });

        describe('against a real tcp server', function performRealTcpServerTests() {
            //these hit a real (if local) tcp connection, so give them a bit more headroom than the
            //default mocha timeout under system load rather than the fixed-size timers used elsewhere
            this.timeout(10_000);

            let server: net.Server | undefined;
            let serverSocket: net.Socket | undefined;
            let telnetSocket: RokuDeploySocket | undefined;

            afterEach(async () => {
                telnetSocket?.destroy();
                serverSocket?.destroy();
                telnetSocket = undefined;
                serverSocket = undefined;
                await new Promise<void>((resolve) => {
                    if (server?.listening) {
                        server.close(() => resolve());
                    } else {
                        resolve();
                    }
                });
                server = undefined;
            });

            function startEphemeralServer(): Promise<number> {
                //reset in case a stale reference from a previous test in this describe block is
                //still sitting here; otherwise waitForServerSocket() below could resolve with the
                //old (already-destroyed) socket instead of waiting for the new connection
                serverSocket = undefined;
                return new Promise((resolve) => {
                    server = net.createServer((acceptedSocket) => {
                        serverSocket = acceptedSocket;
                    });
                    server.listen(0, '127.0.0.1', () => {
                        resolve((server.address() as net.AddressInfo).port);
                    });
                });
            }

            /**
             * Waits for the server side to see the accepted connection. Event-driven (via the
             * server's own 'connection' event) rather than polling, so it cannot resolve early with a
             * stale socket left over from a previous test.
             */
            function waitForServerSocket(): Promise<net.Socket> {
                if (serverSocket) {
                    return Promise.resolve(serverSocket);
                }
                return new Promise((resolve) => {
                    server.once('connection', (acceptedSocket: net.Socket) => resolve(acceptedSocket));
                });
            }

            it('connects with no arguments to the configured host and port', async () => {
                const port = await startEphemeralServer();
                telnetSocket = createRokuDeploySocket({ device: { host: '127.0.0.1' }, port: port });

                await new Promise<void>((resolve) => {
                    telnetSocket.connect(() => resolve());
                });
            });

            it('passes data both ways once connected', async () => {
                const port = await startEphemeralServer();
                telnetSocket = createRokuDeploySocket({ device: { host: '127.0.0.1' }, port: port });

                await new Promise<void>((resolve) => {
                    telnetSocket.connect(() => resolve());
                });
                serverSocket = await waitForServerSocket();

                const receivedByServer = new Promise<Buffer>((resolve) => {
                    serverSocket.once('data', resolve);
                });
                telnetSocket.write('hello from client');
                expect((await receivedByServer).toString('utf8')).to.equal('hello from client');

                const receivedByClient = new Promise<Buffer>((resolve) => {
                    telnetSocket.once('data', resolve);
                });
                serverSocket.write('hello from server');
                expect((await receivedByClient).toString('utf8')).to.equal('hello from server');
            });
        });
    });

    describe('rce device', () => {
        let fakeWebSocket: FakeWebSocket;
        let capturedWebSocketUrl: string | undefined;
        let capturedWebSocketOptions: WebSocket.ClientOptions | undefined;
        let createdTelnetSockets: RokuDeploySocket[] = [];

        afterEach(() => {
            for (const createdTelnetSocket of createdTelnetSockets) {
                createdTelnetSocket.destroy();
            }
            createdTelnetSockets = [];
        });

        function createRceTelnetSocket(overrides: Partial<SocketOptions> = {}): RokuDeploySocket {
            fakeWebSocket = new FakeWebSocket();
            capturedWebSocketUrl = undefined;
            capturedWebSocketOptions = undefined;
            const telnetSocket = createRokuDeploySocket({
                device: { instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'token-value' },
                port: 8085,
                ...overrides
            });
            sinon.stub(telnetSocket as any, 'createWebSocket').callsFake((url, requestOptions) => {
                capturedWebSocketUrl = url as string;
                capturedWebSocketOptions = requestOptions as WebSocket.ClientOptions;
                return fakeWebSocket as unknown as WebSocket;
            });
            createdTelnetSockets.push(telnetSocket);
            return telnetSocket;
        }

        it('builds the ports websocket url and carries the Authorization bearer header', async () => {
            createRceTelnetSocket().connect();
            await flushMicrotasks();

            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/ports/8085');
            expect(capturedWebSocketOptions.headers).to.eql({ Authorization: 'Bearer token-value' });
        });

        it('omits the Authorization header entirely when the device config has no rceToken', async () => {
            createRceTelnetSocket({ device: { instanceUrl: 'https://device.rce.roku.com/instance/abc' } }).connect();
            await flushMicrotasks();

            expect(capturedWebSocketOptions.headers).to.be.undefined;
        });

        it('builds the url path from the port number', async () => {
            createRceTelnetSocket({ port: 8080 }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/ports/8080');

            createRceTelnetSocket({ port: 8087 }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/ports/8087');
        });

        it('emits connect then ready then data, in that order, once the websocket opens', async () => {
            const telnetSocket = createRceTelnetSocket();
            const emittedEventNames: string[] = [];
            telnetSocket.on('connect', () => emittedEventNames.push('connect'));
            telnetSocket.on('ready', () => emittedEventNames.push('ready'));
            telnetSocket.on('data', () => emittedEventNames.push('data'));

            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');
            fakeWebSocket.emit('message', Buffer.from('hello'), false);

            expect(emittedEventNames).to.eql(['connect', 'ready', 'data']);
        });

        it('invokes the connect listener once the websocket opens, exactly like net.Socket', async () => {
            const telnetSocket = createRceTelnetSocket();
            let connectListenerCalled = false;

            telnetSocket.connect(() => {
                connectListenerCalled = true;
            });
            await flushMicrotasks();
            expect(connectListenerCalled).to.be.false;

            fakeWebSocket.emit('open');
            expect(connectListenerCalled).to.be.true;
        });

        it('surfaces a text message (isBinary false) as a data Buffer with the exact bytes', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            let receivedData: Buffer | undefined;
            telnetSocket.on('data', (data: Buffer) => {
                receivedData = data;
            });
            //attaching a 'data' listener only schedules the stream's switch into flowing mode on the
            //next tick, so a message emitted synchronously right after would otherwise be silently
            //buffered rather than delivered in time for the assertion below
            await flushMicrotasks();
            fakeWebSocket.emit('message', Buffer.from('hello console', 'utf8'), false);

            expect(receivedData.toString('utf8')).to.equal('hello console');
        });

        it('surfaces a binary Buffer message as a data Buffer with the exact bytes', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            let receivedData: Buffer | undefined;
            telnetSocket.on('data', (data: Buffer) => {
                receivedData = data;
            });
            //see the comment in the previous test: let the 'data' listener's flowing-mode switch
            //take effect before pushing data
            await flushMicrotasks();
            const originalBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
            fakeWebSocket.emit('message', originalBytes, true);

            expect(receivedData).to.eql(originalBytes);
        });

        it('concatenates a Buffer[] fragment list into a single data Buffer', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            let receivedData: Buffer | undefined;
            telnetSocket.on('data', (data: Buffer) => {
                receivedData = data;
            });
            //see the comment further up: let the 'data' listener's flowing-mode switch take effect
            //before pushing data
            await flushMicrotasks();
            fakeWebSocket.emit('message', [Buffer.from('foo'), Buffer.from('bar')], true);

            expect(receivedData.toString('utf8')).to.equal('foobar');
        });

        it('normalizes an ArrayBuffer message into a data Buffer with the exact bytes', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            let receivedData: Buffer | undefined;
            telnetSocket.on('data', (data: Buffer) => {
                receivedData = data;
            });
            //see the comment further up: let the 'data' listener's flowing-mode switch take effect
            //before pushing data
            await flushMicrotasks();
            const originalBytes = Uint8Array.from([1, 2, 3, 4]);
            fakeWebSocket.emit('message', originalBytes.buffer, true);

            expect(receivedData).to.eql(Buffer.from(originalBytes));
        });

        it('write() always sends a binary frame, even for a string', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            telnetSocket.write('print "hello"');

            expect(fakeWebSocket.sentFrames).to.have.lengthOf(1);
            expect(Buffer.isBuffer(fakeWebSocket.sentFrames[0].data)).to.be.true;
            expect((fakeWebSocket.sentFrames[0].data as Buffer).toString('utf8')).to.equal('print "hello"');
            expect(fakeWebSocket.sentFrames[0].options).to.eql({ binary: true });
        });

        it('emits error then close when the websocket handshake fails', async () => {
            const telnetSocket = createRceTelnetSocket();
            const emittedEventNames: string[] = [];
            let emittedError: Error | undefined;
            telnetSocket.on('error', (error: Error) => {
                emittedError = error;
                emittedEventNames.push('error');
            });
            telnetSocket.on('close', () => emittedEventNames.push('close'));

            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('error', new Error('handshake failed'));
            await flushMicrotasks();

            expect(emittedError?.message).to.contain('handshake failed');
            expect(emittedEventNames).to.eql(['error', 'close']);
            expect((emittedError as NodeJS.ErrnoException).code).to.be.undefined;
        });

        it(`tags a 502 upgrade rejection with code 'ECONNREFUSED', matching the LAN retry signal (nothing on the device is listening yet)`, async () => {
            const telnetSocket = createRceTelnetSocket();
            let emittedError: NodeJS.ErrnoException | undefined;
            telnetSocket.on('error', (error: NodeJS.ErrnoException) => {
                emittedError = error;
            });

            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('error', new Error('Unexpected server response: 502'));
            await flushMicrotasks();

            expect(emittedError?.message).to.contain('Unexpected server response: 502');
            expect(emittedError?.code).to.equal('ECONNREFUSED');
        });

        it('leaves a 404 upgrade rejection with no code, so it stays non-retryable (the port is not whitelisted)', async () => {
            const telnetSocket = createRceTelnetSocket();
            let emittedError: NodeJS.ErrnoException | undefined;
            telnetSocket.on('error', (error: NodeJS.ErrnoException) => {
                emittedError = error;
            });

            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('error', new Error('Unexpected server response: 404'));
            await flushMicrotasks();

            expect(emittedError?.message).to.contain('Unexpected server response: 404');
            expect(emittedError?.code).to.be.undefined;
        });

        it('emits error then close when the instance url fails to resolve', async () => {
            const telnetSocket = createRceTelnetSocket({ device: { id: 123 } });
            const emittedEventNames: string[] = [];
            let emittedError: Error | undefined;
            telnetSocket.on('error', (error: Error) => {
                emittedError = error;
                emittedEventNames.push('error');
            });
            telnetSocket.on('close', () => emittedEventNames.push('close'));

            telnetSocket.connect();
            await flushMicrotasks();
            await flushMicrotasks();

            expect(emittedError?.message).to.contain('rceToken');
            expect(emittedEventNames).to.eql(['error', 'close']);
            expect(capturedWebSocketUrl).to.be.undefined;
        });

        it('does not open a websocket if destroy() is called while the instance url is still resolving', async () => {
            const telnetSocket = createRceTelnetSocket();

            telnetSocket.connect();
            telnetSocket.destroy();

            await flushMicrotasks();
            await flushMicrotasks();

            expect(capturedWebSocketUrl).to.be.undefined;
        });

        it('destroy() is idempotent and produces exactly one close event', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            let closeEventCount = 0;
            telnetSocket.on('close', () => {
                closeEventCount++;
            });

            telnetSocket.destroy();
            telnetSocket.destroy();
            await flushMicrotasks();

            expect(closeEventCount).to.equal(1);
            expect(fakeWebSocket.closed).to.be.true;
        });

        it('preserves an explicit wss or ws instanceUrl scheme instead of downgrading it', async () => {
            createRceTelnetSocket({ device: { instanceUrl: 'wss://device.rce.roku.com/instance/abc', rceToken: 'token-value' } }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/ports/8085');

            createRceTelnetSocket({ device: { instanceUrl: 'ws://device.local/instance/abc', rceToken: 'token-value' } }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('ws://device.local/instance/abc/api/v0/ports/8085');
        });

        it('maps a plain http instanceUrl to ws', async () => {
            createRceTelnetSocket({ device: { instanceUrl: 'http://device.local/instance/abc', rceToken: 'token-value' } }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('ws://device.local/instance/abc/api/v0/ports/8085');
        });

        describe('pre-open writes', () => {
            it('buffers writes issued while connecting and flushes them in order once open', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                //issued before the instance url has even resolved
                telnetSocket.write('one');
                telnetSocket.write('two');
                await flushMicrotasks();
                expect(fakeWebSocket.sentFrames).to.be.empty;

                fakeWebSocket.emit('open');
                await flushMicrotasks();
                telnetSocket.write('three');
                await flushMicrotasks();

                expect(fakeWebSocket.sentFrames.map((frame) => (frame.data as Buffer).toString('utf8'))).to.eql(['one', 'two', 'three']);
            });

            it('fails the held write via its callback when the socket is destroyed before opening', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();

                let writeError: Error | undefined;
                telnetSocket.write('never sent', (error) => {
                    writeError = error;
                });
                //an errored write also errors the stream; listen so that does not crash the test
                telnetSocket.on('error', () => { });

                await flushMicrotasks();
                telnetSocket.destroy();
                await flushMicrotasks();

                expect(writeError?.message).to.contain('destroyed');
            });
        });

        describe('remote close', () => {
            it(`emits 'end' then 'close' on a server-initiated close, like a remote FIN`, async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                const emittedEventNames: string[] = [];
                telnetSocket.on('end', () => emittedEventNames.push('end'));
                telnetSocket.on('close', () => emittedEventNames.push('close'));

                fakeWebSocket.emit('close');
                await flushMicrotasks();

                expect(emittedEventNames).to.eql(['end', 'close']);
                expect(telnetSocket.destroyed).to.be.true;
            });

            it(`delivers data received before a server-initiated close, then 'end'`, async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                const emittedEventNames: string[] = [];
                telnetSocket.on('data', (data: Buffer) => emittedEventNames.push(`data:${data.toString('utf8')}`));
                telnetSocket.on('end', () => emittedEventNames.push('end'));
                telnetSocket.on('close', () => emittedEventNames.push('close'));
                //let the 'data' listener's flowing-mode switch take effect before pushing data
                await flushMicrotasks();

                fakeWebSocket.emit('message', Buffer.from('last words'), true);
                fakeWebSocket.emit('close');
                await flushMicrotasks();

                expect(emittedEventNames).to.eql(['data:last words', 'end', 'close']);
            });
        });

        describe('backpressure', () => {
            it('pauses the websocket when the readable buffer fills and resumes once the consumer drains it', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                //a frame larger than the stream's high-water mark with no consumer attached: push()
                //reports the buffer is full, so the socket should stop reading frames off the wire
                fakeWebSocket.emit('message', Buffer.alloc(20_000), true);
                expect(fakeWebSocket.paused).to.be.true;

                //attaching a data listener switches the stream to flowing mode, which drains the
                //buffer and calls _read, which should resume the websocket
                telnetSocket.on('data', () => { });
                await flushMicrotasks();
                expect(fakeWebSocket.paused).to.be.false;
            });
        });

        describe('connect() reuse guards', () => {
            it('throws when connect() is called while already connecting or connected', () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();

                expect(() => telnetSocket.connect()).to.throw('already connecting or connected');
            });

            it('throws when connect() is called on a destroyed socket', () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                telnetSocket.destroy();

                expect(() => telnetSocket.connect()).to.throw('was destroyed');
            });
        });

        describe(`'close' hadError argument`, () => {
            it('reports hadError=true after an error and false after a clean close', async () => {
                const erroredSocket = createRceTelnetSocket();
                erroredSocket.on('error', () => { });
                let erroredHadError: boolean | undefined;
                erroredSocket.on('close', (hadError: boolean) => {
                    erroredHadError = hadError;
                });
                erroredSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('error', new Error('handshake failed'));
                await flushMicrotasks();
                expect(erroredHadError).to.be.true;

                const cleanSocket = createRceTelnetSocket();
                let cleanHadError: boolean | undefined;
                cleanSocket.on('close', (hadError: boolean) => {
                    cleanHadError = hadError;
                });
                cleanSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');
                cleanSocket.destroy();
                await flushMicrotasks();
                expect(cleanHadError).to.be.false;
            });
        });

        describe('end()', () => {
            it('starts the websocket close handshake and reaches exactly one close event once the server completes it', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                const emittedEventNames: string[] = [];
                telnetSocket.on('finish', () => emittedEventNames.push('finish'));
                telnetSocket.on('end', () => emittedEventNames.push('end'));
                telnetSocket.on('close', () => emittedEventNames.push('close'));

                telnetSocket.end();
                await flushMicrotasks();
                //the writable side finished and the close handshake started, but the stream stays
                //alive until the server completes the handshake (the same way a net.Socket stays
                //alive between sending FIN and receiving the remote FIN)
                expect(fakeWebSocket.closed).to.be.true;
                expect(emittedEventNames).to.eql(['finish']);

                //the server completes the websocket close handshake
                fakeWebSocket.emit('close');
                await flushMicrotasks();

                expect(emittedEventNames).to.eql(['finish', 'end', 'close']);
                expect(telnetSocket.destroyed).to.be.true;
            });

            it('flushes a final chunk before starting the close handshake', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                telnetSocket.end('quit\r\n');
                await flushMicrotasks();

                expect(fakeWebSocket.sentFrames).to.have.lengthOf(1);
                expect((fakeWebSocket.sentFrames[0].data as Buffer).toString('utf8')).to.equal('quit\r\n');
                expect(fakeWebSocket.closed).to.be.true;
            });

            it('tears the stream down when called before the websocket has opened', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                //let the connect sequence create the websocket, which then sits in CONNECTING
                await flushMicrotasks();

                let closeEventCount = 0;
                telnetSocket.on('close', () => closeEventCount++);

                telnetSocket.end();
                await flushMicrotasks();

                //there is no open connection to close-handshake with, so the mid-handshake
                //websocket is terminated and the stream destroyed instead of dangling forever
                expect(fakeWebSocket.terminated).to.be.true;
                expect(telnetSocket.destroyed).to.be.true;
                expect(closeEventCount).to.equal(1);
            });
        });

        describe('setTimeout idle semantics', () => {
            it('emits timeout after the configured idle period with no activity, without destroying the connection', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                let timeoutEmitted = false;
                telnetSocket.on('timeout', () => {
                    timeoutEmitted = true;
                });
                telnetSocket.setTimeout(40);

                await wait(80);

                expect(timeoutEmitted).to.be.true;
                expect(telnetSocket.destroyed).to.be.false;
            });

            it('resets the idle timer on incoming data', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                let timeoutEmitted = false;
                telnetSocket.on('timeout', () => {
                    timeoutEmitted = true;
                });
                telnetSocket.setTimeout(60);

                await wait(40);
                fakeWebSocket.emit('message', Buffer.from('still alive'), false);
                await wait(40);
                expect(timeoutEmitted).to.be.false;

                await wait(40);
                expect(timeoutEmitted).to.be.true;
            });

            it('resets the idle timer on writes', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                let timeoutEmitted = false;
                telnetSocket.on('timeout', () => {
                    timeoutEmitted = true;
                });
                telnetSocket.setTimeout(60);

                await wait(40);
                telnetSocket.write('still writing');
                await wait(40);
                expect(timeoutEmitted).to.be.false;

                await wait(40);
                expect(timeoutEmitted).to.be.true;
            });

            it('a timeout of 0 disarms the idle timer', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                let timeoutEmitted = false;
                telnetSocket.on('timeout', () => {
                    timeoutEmitted = true;
                });
                telnetSocket.setTimeout(30);
                telnetSocket.setTimeout(0);

                await wait(60);

                expect(timeoutEmitted).to.be.false;
            });

            it('setTimeout accepts a one-shot listener and reports the armed value through the timeout getter', async () => {
                const telnetSocket = createRceTelnetSocket();
                telnetSocket.connect();
                await flushMicrotasks();
                fakeWebSocket.emit('open');

                expect(telnetSocket.timeout).to.be.undefined;

                let listenerFired = false;
                telnetSocket.setTimeout(30, () => {
                    listenerFired = true;
                });

                expect(telnetSocket.timeout).to.equal(30);

                await wait(60);

                expect(listenerFired).to.be.true;
            });
        });

        it('resolves an id-addressed device through the management api and connects to the resolved instance url', async () => {
            sinon.stub(RceManagementClient.prototype, 'getInstanceUrl').resolves('https://device.rce.roku.com/instance/resolved');
            const telnetSocket = createRceTelnetSocket({ device: { id: 42, rceToken: 'token-value' } });

            telnetSocket.connect();
            await flushMicrotasks();
            await flushMicrotasks();

            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/resolved/api/v0/ports/8085');
        });

        it('swallows a resolution failure that lands after destroy()', async () => {
            const telnetSocket = createRceTelnetSocket({ device: { id: 42, rceToken: 'token-value' } });
            let rejectResolution: (error: Error) => void;
            sinon.stub(telnetSocket as any, 'resolveInstanceUrl').returns(new Promise((resolve, reject) => {
                rejectResolution = reject;
            }));
            const emittedErrors: Error[] = [];
            telnetSocket.on('error', (error: Error) => emittedErrors.push(error));

            telnetSocket.connect();
            telnetSocket.destroy();
            rejectResolution(new Error('resolution failed'));
            await flushMicrotasks();
            await flushMicrotasks();

            expect(emittedErrors).to.eql([]);
            expect(capturedWebSocketUrl).to.be.undefined;
        });

        it('connect() never throws, even when the connection sequence itself crashes', async () => {
            const telnetSocket = createRceTelnetSocket();
            sinon.stub(telnetSocket as any, 'beginConnecting').rejects(new Error('unexpected crash'));

            expect(() => telnetSocket.connect()).not.to.throw();
            await flushMicrotasks();
        });

        it('creates a real ws websocket outside of tests (every other test stubs the factory)', () => {
            const telnetSocket = createRokuDeploySocket({ device: { instanceUrl: 'https://device.rce.roku.com/instance/abc' }, port: 8085 });
            const webSocket = (telnetSocket as any).createWebSocket('ws://127.0.0.1:1', {}) as WebSocket;

            expect(webSocket).to.be.instanceOf(ws.WebSocket);

            //the connection attempt targets a closed port; silence and abort it
            webSocket.on('error', () => { });
            webSocket.terminate();
            telnetSocket.destroy();
        });

        it('fails a write issued after the connection closed, naming the esn-addressed target', async () => {
            sinon.stub(RceManagementClient.prototype, 'getInstanceUrl').resolves('https://device.rce.roku.com/instance/abc');
            const telnetSocket = createRceTelnetSocket({ device: { esn: 'XY123', rceToken: 'token-value' } });
            telnetSocket.connect();
            await flushMicrotasks();
            await flushMicrotasks();
            fakeWebSocket.emit('open');
            //the connection dropped but the stream has not observed the close yet
            fakeWebSocket.readyState = FakeWebSocket.CLOSED;

            //the failed write also surfaces through the stream's 'error' event; observe it so it
            //does not become an uncaught exception
            telnetSocket.on('error', () => { });
            let writeError: Error | undefined;
            telnetSocket.write('too late', (error: Error) => {
                writeError = error;
            });
            await flushMicrotasks();

            expect(writeError?.message).to.equal(`Cannot write to RCE device esn 'XY123' (port 8085): the connection is not open`);
        });

        it('ignores a websocket error that fires after destroy()', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            const emittedErrors: Error[] = [];
            telnetSocket.on('error', (error: Error) => emittedErrors.push(error));
            telnetSocket.destroy();
            fakeWebSocket.emit('error', new Error('late error'));
            await flushMicrotasks();

            expect(emittedErrors).to.eql([]);
        });

        it('_write converts a string chunk itself when invoked directly (the stream normally decodes first)', async () => {
            const telnetSocket = createRceTelnetSocket();
            telnetSocket.connect();
            await flushMicrotasks();
            fakeWebSocket.emit('open');

            let writeError: Error | null | undefined;
            (telnetSocket as any)._write('raw string', 'utf8', (error?: Error | null) => {
                writeError = error;
            });

            expect(writeError).to.be.undefined;
            expect((fakeWebSocket.sentFrames[0].data as Buffer).toString('utf8')).to.equal('raw string');
        });

        it('end() before connect() destroys the stream cleanly (there is no websocket to close)', async () => {
            const telnetSocket = createRceTelnetSocket();
            let closed = false;
            telnetSocket.on('close', () => {
                closed = true;
            });

            telnetSocket.end();
            await flushMicrotasks();
            await flushMicrotasks();

            expect(closed).to.be.true;
            expect(telnetSocket.destroyed).to.be.true;
        });

        it('tolerates a timer implementation whose handle has no unref (non-Node runtimes)', () => {
            const telnetSocket = createRceTelnetSocket();
            const fakeTimerHandle = {};
            const setTimeoutStub = sinon.stub(global, 'setTimeout').returns(fakeTimerHandle as any);
            try {
                telnetSocket.setTimeout(30);
            } finally {
                setTimeoutStub.restore();
            }

            expect(setTimeoutStub.calledOnce).to.be.true;
            expect(telnetSocket.timeout).to.equal(30);

            //disarm so the fake handle is cleared and cannot fire
            telnetSocket.setTimeout(0);
        });

        it('reports no addresses (there is no underlying tcp connection)', () => {
            const telnetSocket = createRceTelnetSocket() as any;

            expect(telnetSocket.remoteAddress).to.be.undefined;
            expect(telnetSocket.remotePort).to.be.undefined;
            expect(telnetSocket.localAddress).to.be.undefined;
            expect(telnetSocket.localPort).to.be.undefined;
            expect(telnetSocket.localFamily).to.be.undefined;
        });
    });
});
