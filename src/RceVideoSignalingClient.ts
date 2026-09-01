import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import type { IceServer } from './RceManagementClient';

/**
 * Negotiates a Roku Cloud Emulator (RCE) device's video/audio stream over the Janus WebSocket
 * signaling protocol: create a session, attach the streaming plugin, then a 'watch' request
 * resolves with a jsep SDP offer. Signaling only — no WebRTC dependency: connect() resolves with
 * the offer, and the caller answers and trickles ICE via sendAnswer()/sendCandidate()/
 * sendCandidatesComplete(). A keepalive is sent every 25s (Janus sessions time out at 60s), and
 * async plugin requests are acked immediately with their result delivered later as an event; both
 * settle the pending request sharing their `transaction` id.
 *
 * This lives here (rather than in the caller) because the Janus WebSocket host requires an
 * `Authorization: Bearer` header on the handshake itself, which a browser WebSocket cannot set —
 * so this class runs under Node's `ws` and hands the offer/answer/candidates off to wherever the
 * actual RTCPeerConnection lives (for example across a message channel to a browser or webview).
 */
export class RceVideoSignalingClient extends EventEmitter {
    constructor(
        private readonly config: RceVideoSignalingConfig,
        options?: RceVideoSignalingClientOptions
    ) {
        super();
        this.keepaliveIntervalMs = options?.keepaliveIntervalMs ?? 25000;
        this.negotiationTimeoutMs = options?.negotiationTimeoutMs ?? 20000;
    }

    private readonly keepaliveIntervalMs: number;

    private readonly negotiationTimeoutMs: number;

    private webSocket: WebSocket | undefined;

    private sessionId: number | undefined;

    private handleId: number | undefined;

    private keepaliveTimerId: ReturnType<typeof setInterval> | undefined;

    private readonly pendingRequests = new Map<string, PendingJanusRequest>();

    /**
     * Settles the pending websocket-handshake promise; stored because stop() strips the socket
     * listeners that promise is built on, so stop() and the unexpected-close handler must reject it
     * directly or a connect() cancelled mid-handshake would hang until the negotiation timeout.
     */
    private rejectConnected: ((error: Error) => void) | undefined;

    private transactionCounter = 0;

    /**
     * Type-safe wrapper around EventEmitter#on for this class's event map.
     */
    public on<K extends keyof RceVideoSignalingClientEvents>(event: K, listener: RceVideoSignalingClientEvents[K]): this {
        super.on(event, listener as (...args: any[]) => void);
        return this;
    }

    /**
     * Connect and negotiate as far as the SDP offer. Rejects (tearing the session down) if
     * negotiation exceeds `negotiationTimeoutMs`, so a silently unresponsive gateway fails loudly.
     * One session at a time — a second connect() while one is active rejects (it would orphan the
     * first websocket with its listeners still driving this client); call stop() before reconnecting.
     */
    public async connect(): Promise<RceVideoSignalingOffer> {
        if (this.webSocket) {
            throw new Error(`Janus signaling session for stream '${this.config.streamId}' is already connected or connecting; call stop() before reconnecting`);
        }
        let negotiationSettled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        const negotiationPromise = this.negotiate();
        //without this, a negotiate() rejection arriving after the timeout already won the race below
        //(for example because the timeout's stop() rejected an in-flight sendRequest) would otherwise
        //be an unhandled promise rejection
        negotiationPromise.catch(() => { });

        const timeoutPromise = new Promise<never>((resolve, reject) => {
            timeoutHandle = setTimeout(() => {
                if (negotiationSettled) {
                    return;
                }
                negotiationSettled = true;
                this.stop();
                reject(new Error(`Timed out negotiating the Janus stream '${this.config.streamId}'`));
            }, this.negotiationTimeoutMs);
        });

        try {
            return await Promise.race([negotiationPromise, timeoutPromise]);
        } catch (error) {
            //a failed negotiation (a connection failure, a Janus or plugin error, a missing offer)
            //must not leave the keepalive timer running and the socket open behind the rejection;
            //stop() is idempotent, so the timeout path above having already called it is fine
            this.stop();
            throw error;
        } finally {
            negotiationSettled = true;
            clearTimeout(timeoutHandle);
        }
    }

    /**
     * Creates the websocket that carries the Janus signaling traffic. A dedicated method (rather
     * than an inline `new WebSocket(...)` in `negotiate()`) so tests can stub it with a fake.
     */
    private createWebSocket(url: string, requestOptions: WebSocket.ClientOptions): WebSocket {
        return new WebSocket(url, 'janus-protocol', requestOptions);
    }

    private async negotiate(): Promise<RceVideoSignalingOffer> {
        const webSocket = this.createWebSocket(this.config.websocketUrl, {
            headers: { Authorization: `Bearer ${this.config.apiToken}` }
        });
        this.webSocket = webSocket;

        const connected = new Promise<void>((resolve, reject) => {
            this.rejectConnected = reject;
            webSocket.once('open', () => resolve());
            webSocket.once('error', (error: Error) => reject(new Error(`Failed to connect to the Janus WebSocket: ${error.message}`)));
        });
        webSocket.on('message', (data: WebSocket.RawData) => this.handleMessage(data.toString()));
        webSocket.on('close', () => {
            this.stopKeepalive();
            //the socket is gone: nothing can ever answer the requests still in flight, and nothing
            //sent from now on would reach the gateway, so fail both loudly (a dead sendAnswer()
            //must reject, not hang its caller forever)
            this.webSocket = undefined;
            this.sessionId = undefined;
            this.handleId = undefined;
            const closedError = new Error(`The Janus WebSocket for stream '${this.config.streamId}' closed unexpectedly`);
            this.rejectConnected?.(closedError);
            this.rejectConnected = undefined;
            this.rejectPendingRequests(closedError);
            this.emit('close');
        });

        await connected;
        this.rejectConnected = undefined;
        //from here on, a socket error is a session-lifetime error rather than a failed connection attempt
        webSocket.removeAllListeners('error');
        webSocket.on('error', (error: Error) => {
            this.emit('error', new Error(`Janus WebSocket error: ${error.message}`));
        });

        const createResponse = await this.sendRequest({ janus: 'create' });
        this.sessionId = createResponse.data?.id;
        this.startKeepalive();

        const attachResponse = await this.sendRequest({
            janus: 'attach',
            'session_id': this.sessionId,
            plugin: 'janus.plugin.streaming'
        });
        this.handleId = attachResponse.data?.id;

        const watchResponse = await this.sendRequest({
            janus: 'message',
            'session_id': this.sessionId,
            'handle_id': this.handleId,
            body: {
                request: 'watch',
                id: this.config.streamId,
                //a falsy pin (undefined, null, or empty string) all mean "no pin", unlike streamId
                //above, which is sent as-is since a stream id of 0 is a legitimate value
                ...(this.config.pin ? { pin: this.config.pin } : {})
            }
        });

        const offer = watchResponse.jsep;
        if (!offer?.sdp) {
            throw new Error(`Janus did not return an SDP offer for stream '${this.config.streamId}'`);
        }

        return { offer: offer, iceServers: this.config.iceServers ?? [] };
    }

    /**
     * Answer the offer returned by connect(). Sends the `start` plugin message with the answer and
     * resolves once Janus's response to it arrives.
     */
    public async sendAnswer(jsep: RceVideoJsep): Promise<void> {
        await this.sendRequest({
            janus: 'message',
            'session_id': this.sessionId,
            'handle_id': this.handleId,
            body: { request: 'start' },
            jsep: jsep
        });
    }

    /**
     * Trickle a single local ICE candidate to Janus.
     */
    public sendCandidate(candidate: unknown): void {
        this.sendFireAndForget({
            janus: 'trickle',
            'session_id': this.sessionId,
            'handle_id': this.handleId,
            candidate: candidate
        });
    }

    /**
     * Tell Janus local ICE gathering has finished.
     */
    public sendCandidatesComplete(): void {
        this.sendFireAndForget({
            janus: 'trickle',
            'session_id': this.sessionId,
            'handle_id': this.handleId,
            candidate: { completed: true }
        });
    }

    /**
     * Tear the session down: best-effort session destroy, then close the socket and clear the
     * keepalive timer. Safe to call more than once, or before connect() has finished.
     */
    public stop(): void {
        this.stopKeepalive();

        //a connect() still waiting on the websocket handshake can only be settled from here:
        //removeAllListeners() below strips the 'open'/'error' listeners its promise is built on
        this.rejectConnected?.(new Error(`Janus signaling session for stream '${this.config.streamId}' was stopped`));
        this.rejectConnected = undefined;

        if (this.sessionId !== undefined) {
            this.sendFireAndForget({ janus: 'destroy', 'session_id': this.sessionId });
        }

        if (this.webSocket) {
            const webSocket = this.webSocket;
            webSocket.removeAllListeners();
            //closing (or terminating) a socket that is still CONNECTING makes ws abort the handshake
            //and emit an 'error' ("WebSocket was closed before the connection was established"). With
            //no listener, Node's EventEmitter throws that error rather than swallowing it, so retain a
            //no-op listener here before closing rather than leaving the socket listener-less
            webSocket.on('error', () => { });
            try {
                //close() waits on the closing handshake, which never completes for a socket that never
                //finished opening; terminate() tears the connection down immediately instead
                if (webSocket.readyState === WebSocket.CONNECTING) {
                    webSocket.terminate();
                } else {
                    webSocket.close();
                }
            } catch {
                //ws can also throw synchronously here; either way the socket is being discarded
            }
            this.webSocket = undefined;
        }

        this.rejectPendingRequests(new Error(`Janus signaling session for stream '${this.config.streamId}' was stopped`));

        this.sessionId = undefined;
        this.handleId = undefined;
    }

    /**
     * Rejects every request still waiting on a Janus response, because nothing can answer them
     * anymore (the session was stopped, or the socket closed under it).
     */
    private rejectPendingRequests(error: Error): void {
        for (const pendingRequest of this.pendingRequests.values()) {
            pendingRequest.reject(error);
        }
        this.pendingRequests.clear();
    }

    private handleMessage(rawData: string): void {
        let message: JanusIncomingMessage;
        try {
            message = JSON.parse(rawData);
        } catch {
            return;
        }

        if (message.janus === 'ack') {
            //acknowledges receipt of an asynchronous request; the real response arrives later as a
            //'success' or 'event' carrying the same transaction
            return;
        }
        if (message.janus === 'success' || message.janus === 'event') {
            this.settlePendingRequest(message.transaction, message, undefined);
            return;
        }
        if (message.janus === 'error') {
            const errorMessage = this.describeJanusError(message);
            const wasPending = this.settlePendingRequest(message.transaction, undefined, errorMessage);
            if (!wasPending) {
                this.emit('error', new Error(errorMessage));
            }
            return;
        }
        if (message.janus === 'hangup') {
            this.emit('error', new Error(`Janus hung up on stream '${this.config.streamId}'${message.reason ? `: ${message.reason}` : ''}`));
        }
        //keepalive acks, webrtcup/media/slowlink notifications, and other informational events are
        //not currently surfaced
    }

    /**
     * Resolves or rejects the pending request matching `transaction`, if there is one. Plugin-level
     * errors arrive as Janus-protocol successes but are treated as rejections so the real reason surfaces.
     * @returns whether a pending request was found (and settled)
     */
    private settlePendingRequest(transaction: string | undefined, message: JanusIncomingMessage | undefined, errorMessage: string | undefined): boolean {
        if (transaction === undefined) {
            return false;
        }
        const pendingRequest = this.pendingRequests.get(transaction);
        if (!pendingRequest) {
            return false;
        }
        this.pendingRequests.delete(transaction);

        const pluginErrorMessage = message ? this.describePluginError(message) : undefined;
        if (errorMessage !== undefined) {
            pendingRequest.reject(new Error(errorMessage));
        } else if (pluginErrorMessage !== undefined) {
            pendingRequest.reject(new Error(pluginErrorMessage));
        } else {
            pendingRequest.resolve(message);
        }
        return true;
    }

    private describeJanusError(message: JanusIncomingMessage): string {
        const reason = message.error?.reason ?? 'unknown error';
        const code = message.error?.code;
        return `Janus error for stream '${this.config.streamId}'${code !== undefined ? ` (code ${code})` : ''}: ${reason}`;
    }

    /**
     * Describes a streaming-plugin-level error (for example a wrong pin or unknown stream id),
     * which arrives as a normal 'event' with no jsep rather than a top-level `{janus:'error'}`.
     */
    private describePluginError(message: JanusIncomingMessage): string | undefined {
        const pluginErrorText = message.plugindata?.data?.error;
        if (pluginErrorText === undefined) {
            return undefined;
        }
        const errorCode = message.plugindata.data.error_code;
        return `Janus plugin error for stream '${this.config.streamId}'${errorCode !== undefined ? ` (code ${errorCode})` : ''}: ${pluginErrorText}`;
    }

    private sendRequest(request: Record<string, unknown>): Promise<JanusIncomingMessage> {
        const transaction = this.nextTransactionId();
        return new Promise<JanusIncomingMessage>((resolve, reject) => {
            //the socket is gone once stop() has run (or before connect()); reject rather than
            //leaving an orphaned pending request behind a TypeError
            if (!this.webSocket) {
                reject(new Error(`Cannot send a Janus request for stream '${this.config.streamId}': the signaling session is not connected`));
                return;
            }
            this.pendingRequests.set(transaction, { resolve: resolve, reject: reject });
            this.webSocket.send(JSON.stringify(this.withTransactionAndSecret(request, transaction)));
        });
    }

    private sendFireAndForget(request: Record<string, unknown>): void {
        this.webSocket?.send(JSON.stringify(this.withTransactionAndSecret(request, this.nextTransactionId())));
    }

    private withTransactionAndSecret(request: Record<string, unknown>, transaction: string): Record<string, unknown> {
        return {
            ...request,
            transaction: transaction,
            //the RCE Janus gateway uses API-secret auth: the janusToken value must be sent as
            //apisecret on every request, not as token (a stored-token auth field Janus also supports,
            //but this gateway does not accept - it 403s "Unauthorized request" on create with token)
            ...(this.config.janusToken !== undefined ? { apisecret: this.config.janusToken } : {})
        };
    }

    private nextTransactionId(): string {
        this.transactionCounter += 1;
        return `rce-video-${this.transactionCounter}`;
    }

    private startKeepalive(): void {
        //never stack a second timer on top of an existing one
        this.stopKeepalive();
        this.keepaliveTimerId = setInterval(() => {
            if (this.sessionId !== undefined) {
                this.sendFireAndForget({ janus: 'keepalive', 'session_id': this.sessionId });
            }
        }, this.keepaliveIntervalMs);
    }

    private stopKeepalive(): void {
        if (this.keepaliveTimerId) {
            clearInterval(this.keepaliveTimerId);
            this.keepaliveTimerId = undefined;
        }
    }
}

/**
 * Everything needed to negotiate a stream from a running RCE device's Janus gateway (built from the
 * device's `runningDevice` Janus fields).
 */
export interface RceVideoSignalingConfig {
    websocketUrl: string;
    streamId: number;
    pin?: string;
    /**
     * The management api's `janusToken` device field, sent as the `apisecret` field on every Janus
     * request (NOT `token`, a stored-token auth field Janus also supports but this gateway rejects
     * with a 403 on create). Distinct from `apiToken`, which authenticates the WebSocket handshake itself.
     */
    janusToken?: string;
    /**
     * RCE management api bearer token, sent as `Authorization: Bearer <apiToken>` on the WebSocket
     * handshake. Not the same credential as `janusToken`.
     */
    apiToken: string;
    iceServers?: IceServer[];
}

export interface RceVideoSignalingClientOptions {
    /**
     * How often to send a Janus keepalive. Defaults to 25000ms (Janus sessions time out at 60s).
     */
    keepaliveIntervalMs?: number;
    /**
     * How long connect() waits (from connecting through the 'watch' request's response) before
     * giving up and rejecting. Defaults to 20000ms.
     */
    negotiationTimeoutMs?: number;
}

export interface RceVideoSignalingOffer {
    offer: RceVideoJsep;
    iceServers: IceServer[];
}

export interface RceVideoJsep {
    type: string;
    sdp: string;
}

export interface RceVideoSignalingClientEvents {
    error: (error: Error) => void;
    close: () => void;
}

interface PendingJanusRequest {
    resolve: (message: JanusIncomingMessage) => void;
    reject: (error: Error) => void;
}

interface JanusIncomingMessage {
    janus: string;
    transaction?: string;
    data?: { id?: number };
    jsep?: RceVideoJsep;
    error?: { code?: number; reason?: string };
    reason?: string;
    /**
     * Carries a streaming-plugin-level error (as opposed to a Janus-core-level `error` message)
     * when a plugin request such as 'watch' fails, for example a wrong pin or unknown stream id
     */
    plugindata?: {
        data?: {
            error?: string;
            'error_code'?: number;
        };
    };
}
