import { expect } from 'chai';
import * as sinonImport from 'sinon';
import * as net from 'net';
import { EventEmitter } from 'events';
import type * as WebSocket from 'ws';
import { createTelnetSocket } from './TelnetSocket';
import type { TelnetSocket, TelnetSocketOptions } from './TelnetSocket';

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

describe('createTelnetSocket', () => {
    it('throws when given a registry name string instead of a device config', () => {
        expect(() => createTelnetSocket({ device: 'my-device' as any })).to.throw('Device registry names are not supported');
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

        it('defaults the brightscript-console channel to port 8085', () => {
            stubRealSocketConnect();
            createTelnetSocket({ device: { host: '1.2.3.4' } }).connect();
            expect(connectedArguments).to.eql([{ port: 8085, host: '1.2.3.4' }]);
        });

        it('defaults the debug-server channel to port 8080', () => {
            stubRealSocketConnect();
            createTelnetSocket({ device: { host: '1.2.3.4' }, channel: 'debug-server' }).connect();
            expect(connectedArguments).to.eql([{ port: 8080, host: '1.2.3.4' }]);
        });

        it('defaults the screensaver channel to port 8087', () => {
            stubRealSocketConnect();
            createTelnetSocket({ device: { host: '1.2.3.4' }, channel: 'screensaver' }).connect();
            expect(connectedArguments).to.eql([{ port: 8087, host: '1.2.3.4' }]);
        });

        it('lets an explicit port option win over the channel default', () => {
            stubRealSocketConnect();
            createTelnetSocket({ device: { host: '1.2.3.4' }, channel: 'debug-server', port: 9999 }).connect();
            expect(connectedArguments).to.eql([{ port: 9999, host: '1.2.3.4' }]);
        });

        describe('against a real tcp server', function performRealTcpServerTests() {
            //these hit a real (if local) tcp connection, so give them a bit more headroom than the
            //default mocha timeout under system load rather than the fixed-size timers used elsewhere
            this.timeout(10_000);

            let server: net.Server | undefined;
            let serverSocket: net.Socket | undefined;
            let telnetSocket: TelnetSocket | undefined;

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
                telnetSocket = createTelnetSocket({ device: { host: '127.0.0.1' }, port: port });

                await new Promise<void>((resolve) => {
                    telnetSocket.connect(() => resolve());
                });
            });

            it('passes data both ways once connected', async () => {
                const port = await startEphemeralServer();
                telnetSocket = createTelnetSocket({ device: { host: '127.0.0.1' }, port: port });

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
        let createdTelnetSockets: TelnetSocket[] = [];

        afterEach(() => {
            for (const createdTelnetSocket of createdTelnetSockets) {
                createdTelnetSocket.destroy();
            }
            createdTelnetSockets = [];
        });

        function createRceTelnetSocket(overrides: Partial<TelnetSocketOptions> = {}): TelnetSocket {
            fakeWebSocket = new FakeWebSocket();
            capturedWebSocketUrl = undefined;
            capturedWebSocketOptions = undefined;
            const telnetSocket = createTelnetSocket({
                device: { instanceUrl: 'https://device.rce.roku.com/instance/abc', rceToken: 'token-value' },
                createWebSocket: (url, requestOptions) => {
                    capturedWebSocketUrl = url;
                    capturedWebSocketOptions = requestOptions;
                    return fakeWebSocket as unknown as WebSocket;
                },
                ...overrides
            });
            createdTelnetSockets.push(telnetSocket);
            return telnetSocket;
        }

        it('builds the brightscript-console websocket url and carries the Authorization bearer header', async () => {
            createRceTelnetSocket().connect();
            await flushMicrotasks();

            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/telnet/brightscript-console');
            expect(capturedWebSocketOptions.headers).to.eql({ Authorization: 'Bearer token-value' });
        });

        it('omits the Authorization header entirely when the device config has no rceToken', async () => {
            createRceTelnetSocket({ device: { instanceUrl: 'https://device.rce.roku.com/instance/abc' } }).connect();
            await flushMicrotasks();

            expect(capturedWebSocketOptions.headers).to.be.undefined;
        });

        it('selects the url path by channel', async () => {
            createRceTelnetSocket({ channel: 'debug-server' }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/telnet/debug-server');

            createRceTelnetSocket({ channel: 'screensaver' }).connect();
            await flushMicrotasks();
            expect(capturedWebSocketUrl).to.equal('wss://device.rce.roku.com/instance/abc/api/v0/telnet/screensaver');
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
        });

        it('emits error then close when the instance url fails to resolve', async () => {
            const telnetSocket = createRceTelnetSocket({ device: { id: 'device-id-without-a-token' } });
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
        });
    });
});
