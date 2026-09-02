import * as crypto from 'crypto';
import * as needle from 'needle';
import * as urlModule from 'url';
import type { ReadStream } from 'fs';

/**
 * roku-deploy's HTTP transport: a thin promise wrapper over `needle` carrying the device-specific
 * behavior roku-deploy needs (a digest dance that never sends a body unauthenticated, socket and
 * timeout handling that lets the process exit, binary-safe downloads). Responses come back as
 * roku-deploy's own `HttpResponse` shape rather than any HTTP library's native response, so the
 * library underneath can be swapped without breaking consumers.
 */
export class Request {

    /**
     * POST a request. A raw `body` is sent verbatim; otherwise `formData` (if any) is sent as
     * multipart/form-data, and an empty formData object falls back to a bodyless POST.
     */
    public async post(params: RequestOptions): Promise<HttpResponse> {
        const { url, data, needleOptions } = this.translateOptions(params, 'POST');
        //Never let needle's own digest dance send a request body: needle sends the FULL body on the
        //unauthenticated first leg, but the Roku answers the 401 without reading it and closes the socket —
        //a body still mid-write dies with `write EPIPE` before needle's retry can run (only large zips hit
        //this; smaller bodies fit in the socket buffers). So for any authenticated POST with a body, probe
        //for the challenge first and only ever send the body WITH the Authorization header.
        if (data && needleOptions.auth === 'digest') {
            return this.postWithDigestPreflight(url, data, needleOptions);
        }
        return this.send('post', url, data, needleOptions);
    }

    /**
     * GET a request.
     */
    public async get(params: RequestOptions): Promise<HttpResponse> {
        const { url, needleOptions } = this.translateOptions(params, 'GET');
        return this.send('get', url, null, needleOptions);
    }

    /**
     * HEAD a request. Useful for credential/status probes. CAUTION: only safe against routes served
     * by the device's static-file handler (e.g. `/`). Dynamic routes like `/plugin_install` answer a
     * HEAD with a response body — a protocol violation Node's http parser rejects mid-socket.
     */
    public async head(params: RequestOptions): Promise<HttpResponse> {
        const { url, needleOptions } = this.translateOptions(params, 'HEAD');
        return this.send('head', url, null, needleOptions);
    }

    /**
     * GET as a readable stream (`.on('response'|'data'|'error')`, `.pipe(...)`) for file downloads.
     */
    public getStream(params: RequestOptions): NodeJS.ReadableStream {
        const { url, needleOptions } = this.translateOptions(params, 'GET');
        const stream = needle.get(url, needleOptions);

        //needle's stream emits its failures on the `'err'` event, but roku-deploy's download paths
        //listen on `'error'`, so bridge `'err'` -> `'error'`.
        stream.on('err', (err) => stream.emit('error', err));

        //digest auth in streaming mode: needle emits a `'response'` for the 401 challenge and a second one
        //for the authenticated retry. roku-deploy's download paths treat any non-200 `'response'` as a hard
        //failure — so swallow the intermediate 401 and forward only the retried response.
        if (needleOptions.auth && needleOptions.username !== undefined) {
            this.interceptIntermediate401(stream);
        }
        return stream;
    }

    /**
     * POST a request whose body is only ever sent WITH an Authorization header: a bodyless probe collects
     * the device's digest challenge, we compute the `Authorization` header ourselves, and the real request
     * goes out pre-authorized (needle sees the header and skips its own 401 dance). If the probe doesn't
     * yield a usable challenge (endpoint not auth-protected, unexpected status), the real request is sent
     * unchanged and needle's own 401 dance remains as the fallback.
     */
    private postWithDigestPreflight(url: string, data: any, needleOptions: needle.NeedleOptions): Promise<HttpResponse> {
        //probe with no body and NO credentials: we want the raw 401 challenge back, not needle answering it
        //(which would consume the challenge before the real request could use it)
        const probeOptions: needle.NeedleOptions = { ...needleOptions };
        delete probeOptions.multipart;
        delete probeOptions.username;
        delete probeOptions.password;
        delete probeOptions.auth;

        return new Promise<HttpResponse>((resolve, reject) => {
            needle.post(url, null, probeOptions, (probeError, probeResponse) => {
                if (probeError) {
                    return reject(probeError);
                }
                const authorizedOptions: needle.NeedleOptions = { ...needleOptions };
                const challengeHeader = probeResponse?.headers?.['www-authenticate'];
                if (probeResponse?.statusCode === 401 && typeof challengeHeader === 'string') {
                    const authorization = buildDigestAuthorization({
                        username: needleOptions.username,
                        password: needleOptions.password ?? '',
                        method: 'POST',
                        //the digest uri must match the request line, which includes any query string
                        uri: urlModule.parse(url).path,
                        challenge: parseDigestChallenge(challengeHeader)
                    });
                    authorizedOptions.headers = { ...authorizedOptions.headers, authorization: authorization };
                }
                needle.post(url, data, authorizedOptions, this.createNeedleCallback(url, 'POST', authorizedOptions, resolve, reject));
            });
        });
    }

    private send(method: 'get' | 'post' | 'head', url: string, data: any, needleOptions: needle.NeedleOptions): Promise<HttpResponse> {
        return new Promise<HttpResponse>((resolve, reject) => {
            const callback = this.createNeedleCallback(url, method.toUpperCase(), needleOptions, resolve, reject);
            if (method === 'post') {
                needle.post(url, data, needleOptions, callback);
            } else if (method === 'get') {
                needle.get(url, needleOptions, callback);
            } else {
                needle.head(url, needleOptions, callback);
            }
        });
    }

    private createNeedleCallback(url: string, method: string, needleOptions: needle.NeedleOptions, resolve: (response: HttpResponse) => void, reject: (error: Error) => void) {
        return (error: Error | null, response: any, body: any) => {
            if (error) {
                return reject(error);
            }
            if (!response) {
                return reject(new Error(`No response received from ${url}`));
            }
            resolve(this.buildResponse(response, url, method, needleOptions, this.coerceBody(body)));
        };
    }

    /**
     * Build roku-deploy's own `HttpResponse` from needle's response, carrying just the fields
     * consumers read plus the request that produced it (for error messages and diagnostics).
     */
    private buildResponse(needleResponse: any, url: string, method: string, needleOptions: needle.NeedleOptions, body: string): HttpResponse {
        return {
            statusCode: needleResponse.statusCode,
            statusMessage: needleResponse.statusMessage,
            headers: needleResponse.headers ?? {},
            body: body,
            request: {
                url: url,
                method: method,
                //legacy url.parse is total for string input (it never throws), unlike `new URL()`
                host: urlModule.parse(url).hostname ?? undefined,
                headers: needleOptions.headers as Record<string, any>
            }
        };
    }

    /**
     * Translate roku-deploy's request options into the `(url, data, needleOptions)` triple that
     * needle expects.
     */
    private translateOptions(params: RequestOptions, method: 'GET' | 'POST' | 'HEAD') {
        const url = this.buildUrl(params);

        const needleOptions: needle.NeedleOptions = {
            //Roku responses are HTML/XML that roku-deploy parses by hand; never let needle auto-parse them
            'parse_response': false,
            //never let needle charset-decode a response: a signed pkg served with a charset in its
            //content-type (the RCE instance proxy does this) would get every non-utf8 byte replaced with
            //U+FFFD, corrupting the binary. `coerceBody` handles the Buffer->string conversion for text paths.
            'decode_response': false,
            //`timeout` bounds the connection and the time to the first response byte. Deliberately do NOT
            //set `read_timeout`: its per-chunk re-armed timer can be left running after a digest-auth retry
            //completes — later firing a spurious `request.destroy()` error and keeping the Node event loop
            //alive so the process never exits.
            'open_timeout': params.timeout,
            'response_timeout': params.timeout,
            headers: params.headers
        };

        //needle does not send `Connection: close` on modern Node, so the socket to the Roku stays open
        //after the response and keeps the Node event loop alive — a process that only made roku-deploy
        //requests would never exit. Send `Connection: close` unless the caller asked for keep-alive.
        //
        //ALSO pass `agent: false`: needle otherwise uses Node's POOLING `http.globalAgent`, and the header
        //alone does not stop pooling — the request right after an on-device delete could be handed a pooled
        //keep-alive socket the Roku had already closed, an instant ECONNRESET ("socket hang up").
        //`agent: false` forces a fresh un-pooled socket per request, destroyed afterward.
        if (params.keepAlive !== true) {
            needleOptions.connection = 'close';
            needleOptions.agent = false;
        }

        //digest auth: needle performs the 401-challenge/response dance when `auth: 'digest'` is set
        //(except for bodied POSTs, which take the preflight path in post() above)
        const auth = params.auth;
        if (auth) {
            needleOptions.username = auth.username;
            needleOptions.password = auth.password;
            needleOptions.auth = 'digest';
        }

        let data: any = null;
        if (method === 'POST') {
            //a raw body is written to the wire as-is (no multipart/urlencoding), for routes that read the raw request body
            if (params.body !== undefined && params.body !== null) {
                data = params.body;
            } else {
                const formData = this.translateFormData(params.formData);
                //only send a multipart body when there's actually form data to send. Some POSTs (e.g. ECP
                //keypress) have no body at all; needle's multipart builder throws "Empty multipart body" on an
                //empty object. So fall back to a null body.
                if (Object.keys(formData).length > 0) {
                    data = formData;
                    needleOptions.multipart = true;
                }
            }
        }

        return { url: url, data: data, needleOptions: needleOptions };
    }

    /**
     * Append the `qs` query-string object (if any) onto the url; needle expects it baked into the url.
     */
    private buildUrl(params: RequestOptions): string {
        let url = params.url;
        const qs = params.qs;
        if (qs && Object.keys(qs).length > 0) {
            const search = new URLSearchParams();
            for (const key in qs) {
                if (qs[key] !== undefined && qs[key] !== null) {
                    search.append(key, String(qs[key]));
                }
            }
            const query = search.toString();
            if (query) {
                url += (url.includes('?') ? '&' : '?') + query;
            }
        }
        return url;
    }

    /**
     * Convert a `formData` object into the shape needle's multipart builder understands:
     * - `null`/`undefined`/empty-string fields are dropped entirely (needle's multipart builder
     *   throws `"value missing for multipart!"` on empty values).
     * - a readable stream (e.g. the zip `fs.ReadStream`) is translated into needle's documented
     *   `{ file, content_type }` file-by-path form, since needle does not handle streams.
     */
    private translateFormData(formData: Record<string, any> | undefined): Record<string, any> {
        const result: Record<string, any> = {};
        if (!formData) {
            return result;
        }
        for (const key in formData) {
            const value = formData[key];
            if (value === undefined || value === null || value === '') {
                continue;
            }
            if (this.isReadableStream(value)) {
                const filePath = (value).path;
                result[key] = {
                    file: filePath,
                    'content_type': 'application/octet-stream'
                };
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    private isReadableStream(value: any): value is ReadStream {
        return value && typeof value === 'object' && typeof value.pipe === 'function' && value.readable !== false;
    }

    /**
     * Coerce needle's response body into a `string`. With `parse_response: false`, needle hands back
     * a `Buffer` (an *empty* Buffer for empty responses such as a bare 401); roku-deploy's response
     * verification guards on `typeof body === 'string'`, so anything else would be misreported as an
     * unparsable response.
     */
    private coerceBody(body: any): string {
        if (Buffer.isBuffer(body)) {
            return body.toString();
        }
        if (typeof body === 'string') {
            return body;
        }
        //null/undefined or a parsed object (shouldn't happen with parse_response:false) -> stringify safely
        return body === undefined || body === null ? '' : String(body);
    }

    /**
     * Swallow the intermediate 401 `'response'` event needle emits for the digest challenge on a
     * streaming request, forwarding only the authenticated retry's `'response'`.
     */
    private interceptIntermediate401(stream: NodeJS.ReadableStream) {
        let swallowedChallenge = false;
        const originalEmit = stream.emit.bind(stream);
        stream.emit = ((event: string, ...args: any[]) => {
            if (event === 'response' && !swallowedChallenge) {
                const resp = args[0];
                if (resp && resp.statusCode === 401) {
                    //this is the digest challenge; needle will retry. drop it (just this once).
                    swallowedChallenge = true;
                    return false;
                }
            }
            return originalEmit(event, ...args);
        }) as any;
    }
}

export const request = new Request();

/**
 * Parse the comma-separated key/value pairs out of a `WWW-Authenticate: Digest ...` header.
 * Values may be bare or double-quoted.
 */
export function parseDigestChallenge(header: string): Record<string, string> {
    const out: Record<string, string> = {};
    const body = header.replace(/^Digest\s+/i, '');
    const re = /([a-zA-Z]+)=(?:"((?:[^"\\]|\\.)*)"|([^,]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        out[m[1].toLowerCase()] = m[2] ?? m[3].trim();
    }
    return out;
}

function md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
}

/**
 * Build an RFC 2617 `Authorization: Digest ...` header from a parsed challenge.
 */
export function buildDigestAuthorization(params: {
    username: string;
    password: string;
    method: string;
    uri: string;
    challenge: Record<string, string>;
}): string {
    const { username, password, method, uri, challenge } = params;
    const realm = challenge.realm ?? '';
    const nonce = challenge.nonce ?? '';
    const qop = challenge.qop;
    const algorithm = (challenge.algorithm ?? 'MD5').toUpperCase();
    const cnonce = crypto.randomBytes(8).toString('hex');
    const nc = '00000001';

    const ha1 = algorithm === 'MD5-SESS'
        ? md5(`${md5(`${username}:${realm}:${password}`)}:${nonce}:${cnonce}`)
        : md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${method}:${uri}`);
    const response = qop
        ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${nonce}:${ha2}`);

    const parts = [
        `username="${username}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `algorithm=${algorithm}`,
        `response="${response}"`
    ];
    if (qop) {
        parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    }
    if (challenge.opaque) {
        parts.push(`opaque="${challenge.opaque}"`);
    }
    return `Digest ${parts.join(', ')}`;
}

/**
 * The options accepted by every request method.
 */
export interface RequestOptions {

    /** The full request url (already includes host/port/path). */
    url: string;

    /** Per-request timeout in ms (connection + first-response-byte). */
    timeout?: number;

    /** Outgoing request headers. */
    headers?: Record<string, any>;

    /** Digest-auth credentials. When provided, the 401-challenge/response dance is performed. */
    auth?: {
        username: string;
        password: string;
    };

    /** multipart/form-data fields (string values, or a readable stream for the zip/pkg archive). */
    formData?: Record<string, any>;

    /** Raw POST body (string or Buffer), sent verbatim with no multipart framing. Takes precedence over `formData`. */
    body?: string | Buffer;

    /** Query-string object appended to the url. */
    qs?: Record<string, any>;

    /**
     * Keep the socket open after the response. Defaults to false: each request gets a fresh
     * un-pooled socket that is closed when done, so lingering sockets never pin the Node event
     * loop or get reused after the device closed them.
     */
    keepAlive?: boolean;
}

/**
 * roku-deploy's own HTTP response shape, deliberately independent of the underlying HTTP library
 * (attached to thrown errors and returned by the raw request helpers).
 */
export interface HttpResponse {
    statusCode: number;
    statusMessage?: string;
    /** Response headers, lower-cased names. */
    headers: Record<string, any>;
    /** The response body, decoded as a utf8 string (empty string for bodyless responses). */
    body: string;
    /** The request that produced this response. */
    request: {
        url: string;
        method: string;
        host?: string;
        headers?: Record<string, any>;
    };
}
