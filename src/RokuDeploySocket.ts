import * as net from 'net';
import * as stream from 'stream';
import * as WebSocket from 'ws';
import type { DeviceConfig, LocalDeviceConfig, RceDeviceConfig } from './DeviceConfig';
import { isLocalDeviceConfig, isRceDeviceConfigById, isRceDeviceConfigByUrl, validateDeviceConfig } from './DeviceConfig';
import { RceManagementClient } from './RceManagementClient';

/**
 * Creates a transport for one of a Roku device's telnet consoles (for example the BrightScript
 * console on port 8085, the SceneGraph debug server on port 8080, or the screensaver console on
 * port 8087) that behaves like a `net.Socket` regardless of where the device lives:
 *
 *   - a local network device exposes these as plain-tcp telnet ports
 *   - a Roku Cloud Emulator (RCE) instance exposes the same ports as WebSocket endpoints on its
 *     instance api (`<instanceUrl>/api/v0/ports/<port>`), authed by an
 *     `Authorization: Bearer <rceToken>` header on the WebSocket handshake
 *
 * The returned object is meant as a near-transparent replacement for `new net.Socket()`: it exposes
 * the same `connect()`/`write()`/`destroy()`/`setTimeout()` surface and the same
 * `'connect'`/`'ready'`/`'data'`/`'close'`/`'end'`/`'error'`/`'timeout'` events, satisfying both a
 * real `net.Socket` and this factory's own RCE implementation. Callers that only care about console
 * bytes never need to know (or change any of their code based on) which transport they got.
 */
export function createRokuDeploySocket(options: SocketOptions): RokuDeploySocket {
    //runtime guard for javascript callers, since a registry name (string) cannot be resolved to a
    //device config without the registry this function does not have access to
    if (typeof (options.device as unknown) === 'string') {
        throw new Error('Device registry names are not supported by createRokuDeploySocket; provide a device config object');
    }
    //runtime guard for javascript callers (and for optional ports that were never defaulted
    //upstream), since the port addresses the device console on both transports
    if (!Number.isInteger(options.port) || options.port <= 0) {
        throw new Error(`createRokuDeploySocket requires a valid port number (received ${String(options.port)})`);
    }

    validateDeviceConfig(options.device);

    if (isLocalDeviceConfig(options.device)) {
        return new LocalSocket({ ...options, device: options.device });
    }
    return new RceSocket({ ...options, device: options.device });
}

/**
 * A `net.Socket` wired up to connect to a local device's plain-tcp telnet console using the host and
 * port resolved by `createRokuDeploySocket()`. Every behavior other than `connect()` is real
 * `net.Socket` behavior inherited unchanged; that is the entire point of extending it directly
 * instead of wrapping it in another layer.
 */
export class LocalSocket extends net.Socket {
    constructor(options: LocalSocketOptions) {
        super({ allowHalfOpen: false });
        this.host = options.device.host;
        this.port = options.port;
    }

    private readonly host: string;

    private readonly port: number;

    /**
     * Connects to the host and port resolved by the factory that created this socket, matching
     * `net.Socket`'s own no-argument-address form: the address was already decided when this
     * instance was constructed, so there is nothing left for a caller to specify here. The
     * additional overloads below exist only so this override remains structurally compatible with
     * `net.Socket`'s own `connect()` overloads; nothing in this codebase calls them on a
     * `LocalRokuDeploySocket` directly.
     */
    public connect(connectListener?: () => void): this;
    public connect(connectOptions: net.SocketConnectOpts, connectListener?: () => void): this;
    public connect(port: number, host?: string, connectListener?: () => void): this;
    public connect(port: number, connectListener?: () => void): this;
    public connect(path: string, connectListener?: () => void): this;
    public connect(
        firstArgument?: (() => void) | number | string | net.SocketConnectOpts,
        secondArgument?: (() => void) | string,
        thirdArgument?: () => void
    ): this {
        if (firstArgument === undefined || typeof firstArgument === 'function') {
            return super.connect(this.port, this.host, firstArgument as (() => void) | undefined);
        }
        //not expected to be reached in practice (see the doc comment above), but delegating rather
        //than throwing keeps this a faithful net.Socket subclass for any caller that does use one of
        //the inherited overloads directly
        return super.connect(firstArgument as number, secondArgument as string, thirdArgument);
    }
}

/**
 * A `stream.Duplex` wired up to connect to a Roku Cloud Emulator (RCE) instance's telnet console
 * over its WebSocket endpoint (`<instanceUrl>/api/v0/ports/<port>`), authed by an
 * `Authorization: Bearer <rceToken>` header on the WebSocket handshake.
 *
 * Extending `stream.Duplex` (rather than a plain `EventEmitter`) matters beyond just matching
 * `net.Socket`'s event surface: consumers hand this socket to `telnet-client`, whose `_checkSocket()`
 * guard (used whenever a socket is injected rather than created internally) requires `pipe`,
 * `_write`, `_writableState`, `_read`, and `_readableState`, all of which only a real Node stream
 * provides.
 */
export class RceSocket extends stream.Duplex {
    constructor(options: RceSocketOptions) {
        super();
        this.device = options.device;
        this.port = options.port;
    }

    private readonly device: RceDeviceConfig;

    private readonly port: number;

    private webSocket: WebSocket | undefined;

    private idleTimeoutMilliseconds = 0;

    private idleTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

    private connectCalled = false;

    /**
     * Whether the websocket ever reached OPEN, so teardown paths can distinguish "closed after a
     * live session" (the remote-close path finishes the job) from "never opened" (nothing will).
     */
    private hasConnected = false;

    /**
     * Whether this socket was destroyed by (or after) an error, reported as the `hadError` argument
     * on the `'close'` event exactly like `net.Socket` reports it.
     */
    private hadError = false;

    /**
     * A write issued before the websocket opened, held (chunk and stream callback both) until the
     * `'open'` event flushes it. Holding the callback parks the writable machinery, so at most one
     * write ever sits here - the rest queue inside the stream itself.
     */
    private pendingWrite: PendingWrite | undefined;

    /**
     * Fire-and-forget, exactly like `net.Socket#connect()`: resolves the RCE instance url, opens the
     * websocket, and emits `'connect'` then `'ready'` once the handshake completes (the same order
     * `net.Socket` uses). `connectListener` is registered the same way `net.Socket` registers its
     * own connect callback: as a one-time `'connect'` listener.
     *
     * Unlike `net.Socket` (which allows reconnecting a closed socket), calling this a second time
     * throws: a second websocket would orphan the first one with its listeners still feeding this
     * stream, and a destroyed Duplex cannot be revived, so both misuses fail loudly instead of
     * leaking or silently never calling back.
     */
    public connect(connectListener?: () => void): this {
        if (this.destroyed) {
            throw new Error(`Cannot connect to ${this.describeTarget()}: the socket was destroyed (create a new socket instead)`);
        }
        if (this.connectCalled) {
            throw new Error(`Cannot connect to ${this.describeTarget()}: the socket is already connecting or connected`);
        }
        this.connectCalled = true;
        if (connectListener) {
            this.once('connect', connectListener);
        }
        //beginConnecting() reports every failure itself, through the normal 'error'/'close' events,
        //so nothing here needs (or should) reject or throw
        this.beginConnecting().catch(() => { });
        return this;
    }

    /**
     * Resolve the device to its live instance API URL: an instanceUrl-addressed config is used
     * directly, an id- or esn-addressed config is resolved through the RCE management api (which
     * requires the config's rceToken).
     */
    private async resolveInstanceUrl(): Promise<string> {
        if (isRceDeviceConfigByUrl(this.device)) {
            return this.device.instanceUrl.replace(/\/+$/, '');
        }
        if (!this.device.rceToken) {
            throw new Error('An rceToken is required to resolve an RCE device by id or esn');
        }
        return new RceManagementClient({ token: this.device.rceToken }).getInstanceUrl({ device: this.device });
    }

    private async beginConnecting(): Promise<void> {
        let instanceUrl: string;
        try {
            instanceUrl = await this.resolveInstanceUrl();
        } catch (error) {
            this.failConnection(new Error(`Failed to resolve the RCE instance url for ${this.describeTarget()}: ${(error as Error).message}`));
            return;
        }

        //destroy() may have been called while the instance url was resolving; opening the websocket
        //now would leak an open connection nothing owns
        if (this.destroyed) {
            return;
        }

        const url = this.buildWebSocketUrl(instanceUrl);
        const requestOptions: WebSocket.ClientOptions = this.device.rceToken
            ? { headers: { Authorization: `Bearer ${this.device.rceToken}` } }
            : {};
        const webSocket = this.createWebSocket(url, requestOptions);
        this.webSocket = webSocket;

        webSocket.once('open', () => {
            this.hasConnected = true;
            this.emit('connect');
            this.emit('ready');
            this.flushPendingWrite();
        });
        webSocket.on('message', (data: WebSocket.RawData) => {
            this.markActivity();
            if (!this.push(RceSocket.toBuffer(data))) {
                //the readable buffer hit its high-water mark: stop pulling frames off the wire
                //until _read() reports the consumer has caught up (the same backpressure a
                //net.Socket applies to its tcp stream)
                webSocket.pause();
            }
        });
        webSocket.on('error', (error: Error) => {
            this.failConnection(this.wrapWebSocketError(url, error));
        });
        webSocket.once('close', () => {
            //the connection is gone in both directions, so end both sides of the stream and let it
            //destroy itself (autoDestroy) once 'end' has been delivered - 'end' before 'close', the
            //same order net.Socket guarantees on a remote FIN. read(0) nudges the readable machinery
            //to process the EOF even when no consumer is attached yet.
            this.failPendingWrite(new Error(`Cannot write to ${this.describeTarget()}: the connection closed before it opened`));
            this.push(null);
            this.read(0);
            this.end();
        });
    }

    /**
     * Creates the websocket that carries the console bytes. A dedicated method (rather than an
     * inline `new WebSocket(...)` in `beginConnecting()`) so tests can stub it with a fake.
     */
    private createWebSocket(url: string, requestOptions: WebSocket.ClientOptions): WebSocket {
        return new WebSocket(url, requestOptions);
    }

    /**
     * Sends a chunk as a binary websocket frame. The RCE port endpoints accept binary frames only
     * (a TEXT frame is rejected with close code 1003), and bytes are forwarded unchanged, which is
     * exactly the byte parity a raw tcp socket provides.
     *
     * A write issued before the websocket has opened is held and flushed on `'open'`, the same
     * buffering `net.Socket` applies to writes issued while connecting, so the idiomatic
     * `socket.connect(); socket.write(...)` pattern works on both transports.
     */
    public _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        const bufferedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        if (this.webSocket?.readyState === WebSocket.OPEN) {
            this.markActivity();
            this.webSocket.send(bufferedChunk, { binary: true }, (error) => {
                callback(error);
            });
            return;
        }
        if (this.webSocket && this.webSocket.readyState !== WebSocket.CONNECTING) {
            //CLOSING or CLOSED: this connection will never carry another byte
            callback(new Error(`Cannot write to ${this.describeTarget()}: the connection is not open`));
            return;
        }
        //still connecting (or connect() not called yet): hold the write until 'open' flushes it
        this.pendingWrite = { chunk: bufferedChunk, callback: callback };
    }

    /**
     * Implements the writable half of `end()`. `net.Socket` sends a FIN here; a websocket has no
     * half-close, so the closest equivalent is starting the close handshake. The websocket's own
     * `'close'` event (see `beginConnecting()`) then ends the readable side and the stream destroys
     * itself, so `end()` still arrives at exactly one `'close'` event, just like a `net.Socket`.
     */
    public _final(callback: (error?: Error | null) => void): void {
        if (this.webSocket?.readyState === WebSocket.OPEN) {
            this.webSocket.close();
            callback();
            return;
        }
        callback();
        if (!this.hasConnected) {
            //there was never an open connection, so nothing will ever fire the websocket 'close'
            //event that normally finishes teardown; destroy directly so end() cannot leave the
            //stream (or a mid-handshake websocket) dangling
            this.destroy();
        }
        //otherwise the websocket already closed: its 'close' handler has ended the readable side
        //too, and the stream destroys itself once 'end' has been delivered
    }

    /**
     * Data arrives asynchronously from the websocket's `'message'` event and is pushed as it comes
     * in (see `beginConnecting()`); the only on-demand work is releasing backpressure, since a full
     * readable buffer pauses the websocket until the consumer catches up.
     */
    public _read(size: number): void {
        if (this.webSocket?.isPaused) {
            this.webSocket.resume();
        }
    }

    /**
     * Tears the websocket down (idempotent: safe whether it never finished opening, already closed
     * itself, or is being discarded outright) and lets the stream machinery finish the job, which
     * guarantees exactly one `'close'` event regardless of cause.
     */
    public _destroy(error: Error | undefined, callback: (error?: Error | null) => void): void {
        this.clearIdleTimer();
        if (error) {
            this.hadError = true;
        }
        this.failPendingWrite(error ?? new Error(`Cannot write to ${this.describeTarget()}: the socket was destroyed`));
        if (this.webSocket) {
            const webSocket = this.webSocket;
            //closing (or terminating) a socket that is still CONNECTING makes ws abort the
            //handshake and emit an 'error' ('WebSocket was closed before the connection was
            //established'); a no-op listener keeps that from becoming an unhandled error on a
            //socket that is being discarded anyway
            webSocket.removeAllListeners();
            webSocket.on('error', () => { });
            //close() waits on the closing handshake, which never completes for a socket that never
            //finished opening; terminate() tears the connection down immediately instead
            if (webSocket.readyState === WebSocket.CONNECTING) {
                webSocket.terminate();
            } else {
                webSocket.close();
            }
            this.webSocket = undefined;
        }
        callback(error);
    }

    /**
     * Implements `net.Socket`'s idle-timeout semantics: (re)arms on every read or write and emits
     * `'timeout'` after `timeoutMilliseconds` of silence. Passing `0` disarms it. A timeout never
     * destroys the connection, matching `net.Socket` (the caller decides what to do about it).
     */
    public setTimeout(timeoutMilliseconds: number, timeoutListener?: () => void): this {
        this.idleTimeoutMilliseconds = timeoutMilliseconds;
        if (timeoutListener) {
            this.once('timeout', timeoutListener);
        }
        this.rearmIdleTimer();
        return this;
    }

    /**
     * The idle timeout most recently configured through `setTimeout()`, or `undefined` if none is
     * armed. Mirrors `net.Socket#timeout`, which reports the same thing for logging purposes.
     */
    public get timeout(): number | undefined {
        return this.idleTimeoutMilliseconds > 0 ? this.idleTimeoutMilliseconds : undefined;
    }

    /**
     * There is no underlying tcp connection to report an address for.
     */
    public get remoteAddress(): string | undefined {
        return undefined;
    }

    public get remotePort(): number | undefined {
        return undefined;
    }

    public get localAddress(): string | undefined {
        return undefined;
    }

    public get localPort(): number | undefined {
        return undefined;
    }

    public get localFamily(): string | undefined {
        return undefined;
    }

    /**
     * `net.Socket`'s `'close'` event carries a `hadError` boolean; the stream machinery emits the
     * event with no arguments, so decorate it on the way out.
     */
    public emit(event: string | symbol, ...args: any[]): boolean {
        if (event === 'close' && args.length === 0) {
            return super.emit(event, this.hadError);
        }
        return super.emit(event, ...args);
    }

    /**
     * Sends the write held from before the websocket opened (if there is one) and releases its
     * stream callback, which un-parks the writable machinery so any writes queued behind it flow.
     */
    private flushPendingWrite(): void {
        if (!this.pendingWrite) {
            return;
        }
        const pendingWrite = this.pendingWrite;
        this.pendingWrite = undefined;
        this.markActivity();
        this.webSocket.send(pendingWrite.chunk, { binary: true }, (error) => {
            pendingWrite.callback(error);
        });
    }

    /**
     * Fails the write held from before the websocket opened (if there is one), because the
     * connection it was waiting on will never open.
     */
    private failPendingWrite(error: Error): void {
        if (!this.pendingWrite) {
            return;
        }
        const pendingWrite = this.pendingWrite;
        this.pendingWrite = undefined;
        pendingWrite.callback(error);
    }

    private markActivity(): void {
        if (this.idleTimeoutMilliseconds > 0) {
            this.rearmIdleTimer();
        }
    }

    private rearmIdleTimer(): void {
        clearTimeout(this.idleTimeoutHandle);
        if (this.idleTimeoutMilliseconds > 0) {
            this.idleTimeoutHandle = setTimeout(() => this.emit('timeout'), this.idleTimeoutMilliseconds);
            //net.Socket's timeout timer is unref'd: an idle timer alone must not hold the process open
            this.idleTimeoutHandle.unref?.();
        } else {
            this.idleTimeoutHandle = undefined;
        }
    }

    private clearIdleTimer(): void {
        clearTimeout(this.idleTimeoutHandle);
        this.idleTimeoutHandle = undefined;
    }

    private failConnection(error: Error): void {
        if (this.destroyed) {
            return;
        }
        this.destroy(error);
    }

    /**
     * A 502 upgrade rejection means the port is open but nothing is listening yet (channel still
     * booting) — the same transient condition a local device reports as `ECONNREFUSED`, so it gets
     * that code and consumers retry it. Everything else (e.g. 404 port-not-whitelisted) stays
     * code-less and fatal. `ws` only exposes the status inside the message, hence the match.
     */
    private wrapWebSocketError(url: string, error: Error): NodeJS.ErrnoException {
        const wrappedError: NodeJS.ErrnoException = new Error(`RCE telnet websocket error for ${url}: ${error.message}`);
        if (/Unexpected server response: 502\b/.test(error.message)) {
            wrappedError.code = 'ECONNREFUSED';
        }
        return wrappedError;
    }

    private buildWebSocketUrl(instanceUrl: string): string {
        const url = new URL(`${instanceUrl}/api/v0/ports/${this.port}`);
        //map only the http schemes; an instanceUrl already given as ws:/wss: passes through
        //unchanged (in particular, an explicit wss: must never be downgraded to ws:, which would
        //send the bearer token over an unencrypted handshake)
        if (url.protocol === 'https:') {
            url.protocol = 'wss:';
        } else if (url.protocol === 'http:') {
            url.protocol = 'ws:';
        }
        return url.toString();
    }

    /**
     * Describes the connection target for error messages, without needing to have resolved
     * anything yet (an RCE device addressed by id or esn has no url to show until the instance url
     * finishes resolving, so this falls back to the identifying field instead).
     */
    private describeTarget(): string {
        if (isRceDeviceConfigByUrl(this.device)) {
            return `${this.device.instanceUrl} (port ${this.port})`;
        }
        if (isRceDeviceConfigById(this.device)) {
            return `RCE device id '${this.device.id}' (port ${this.port})`;
        }
        return `RCE device esn '${this.device.esn}' (port ${this.port})`;
    }

    /**
     * Normalizes a websocket message payload to a single Buffer. `ws` delivers a Buffer, an
     * ArrayBuffer, or a Buffer[] (when message fragmentation is not reassembled); text frames arrive
     * already utf8-encoded, so a plain Buffer conversion covers every case identically regardless of
     * whether the original frame was TEXT or BINARY.
     */
    private static toBuffer(data: WebSocket.RawData): Buffer {
        if (Buffer.isBuffer(data)) {
            return data;
        }
        if (Array.isArray(data)) {
            return Buffer.concat(data);
        }
        return Buffer.from(data);
    }
}

interface PendingWrite {
    chunk: Buffer;
    callback: (error?: Error | null) => void;
}

export interface SocketOptions {
    /** the device to connect to. Registry names (strings) are not supported here; pass a resolved device config */
    device: DeviceConfig;
    /**
     * the device port to connect to (for example 8085 for the BrightScript console, 8080 for the
     * SceneGraph debug server, or 8087 for the screensaver console). A local device connects to this
     * tcp port directly; an RCE device reaches the same port through the instance api's
     * `/api/v0/ports/<port>` WebSocket route
     */
    port: number;
}

/**
 * `SocketOptions` narrowed to a local network device, the flavor `LocalSocket` requires
 */
export interface LocalSocketOptions extends SocketOptions {
    device: LocalDeviceConfig;
}

/**
 * `SocketOptions` narrowed to an RCE device, the flavor `RceSocket` requires
 */
export interface RceSocketOptions extends SocketOptions {
    device: RceDeviceConfig;
}

/**
 * The socket-shaped surface consumers write against instead of `net.Socket` directly. A real
 * `net.Socket` (and therefore `LocalRokuDeploySocket`, which extends it) satisfies this interface
 * structurally; `RceRokuDeploySocket` implements it directly. `remoteAddress`, `remotePort`,
 * `localAddress`, `localPort`, `localFamily`, and `timeout` are informational fields carried over
 * from `net.Socket` for logging; an RCE connection has no tcp-level address to report for the first
 * five, so it always reports `undefined` for those.
 */
export interface RokuDeploySocket extends NodeJS.ReadWriteStream {
    connect: (connectListener?: () => void) => this;
    destroy: (error?: Error) => this;
    end: ((callback?: () => void) => this) &
    ((buffer: Uint8Array | string, callback?: () => void) => this) &
    ((str: Uint8Array | string, encoding?: BufferEncoding, callback?: () => void) => this);
    setTimeout: (timeout: number, callback?: () => void) => this;
    readonly destroyed: boolean;
    readonly remoteAddress?: string;
    readonly remotePort?: number;
    readonly localAddress?: string;
    readonly localPort?: number;
    readonly localFamily?: string;
    readonly timeout?: number;
}
