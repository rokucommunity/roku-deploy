/* eslint-disable camelcase */
import * as needle from 'needle';
import * as urlModule from 'url';
import type { ReadStream } from 'fs';

/**
 * A thin compatibility shim over `needle` that mimics the small slice of the
 * `request`/`postman-request` API that roku-deploy relies on. We migrated off
 * `postman-request` (unmaintained, pulls in a large dependency tree) but a lot
 * of roku-deploy's public surface — most notably the `results`/`response`
 * object attached to thrown errors — was shaped by `request`. To keep this a
 * non-breaking change, this shim reconstructs that same shape on top of
 * needle's response object.
 *
 * Only `post` and `get` are implemented, since those are the only verbs
 * roku-deploy uses. `get` additionally supports the callback-less streaming
 * form (`request.get(opts).on(...).pipe(...)`) used when downloading files.
 */
export class Request {

    /**
     * POST a multipart/form-data request, `request`-style. Invokes `callback`
     * with `(error, response, body)`.
     */
    public post(params: RequestOptions, callback: RequestCallback) {
        const { url, data, needleOptions } = this.translateOptions(params, 'POST');
        return needle.post(url, data, needleOptions, (error, response, body) => {
            if (error) {
                return callback(error, undefined, undefined);
            }
            const coerced = this.coerceBody(body);
            return callback(null, this.buildResponse(response, url, coerced), coerced);
        });
    }

    /**
     * GET a request, `request`-style. With a `callback`, invokes it with
     * `(error, response, body)`. Without a callback, returns needle's readable
     * stream (which supports `.on('error'|'response', ...)` and `.pipe(...)`)
     * for the file-download path.
     */
    public get(params: RequestOptions, callback?: RequestCallback) {
        const { url, needleOptions } = this.translateOptions(params, 'GET');
        if (callback) {
            return needle.get(url, needleOptions, (error, response, body) => {
                if (error) {
                    return callback(error, undefined, undefined);
                }
                const coerced = this.coerceBody(body);
                return callback(null, this.buildResponse(response, url, coerced), coerced);
            });
        }
        //streaming form (no callback) - used by getToFile to pipe the response to disk.
        const stream = needle.get(url, needleOptions);

        //needle's stream emits its failures on the `'err'` event, but `request` (and roku-deploy's
        //getToFile) listens on `'error'`, so bridge `'err'` -> `'error'` to preserve that behavior.
        stream.on('err', (err) => stream.emit('error', err));

        //digest auth in streaming mode: needle issues the unauthenticated request, emits a `'response'`
        //for the 401 challenge, and *then* transparently retries with the Authorization header (emitting
        //a second `'response'`). `request`/`postman-request` only ever surfaced the final response, and
        //roku-deploy's `getToFile` treats any non-200 `'response'` as a hard failure. So when we're doing
        //digest auth, swallow the intermediate 401 `'response'` event and only forward the retried one.
        if (needleOptions.auth && needleOptions.username !== undefined) {
            this.interceptIntermediate401(stream);
        }
        return stream;
    }

    /**
     * Translate the `request`-style options object that roku-deploy builds into the
     * `(url, data, needleOptions)` triple that needle expects.
     */
    private translateOptions(params: RequestOptions, method: 'GET' | 'POST') {
        const url = this.buildUrl(params);

        const needleOptions: needle.NeedleOptions = {
            //Roku responses are HTML/XML that roku-deploy parses by hand; never let needle auto-parse them
            parse_response: false,
            //`request` had a single `timeout` that governed how long to wait to establish the connection and
            //receive a response. Map it to needle's `open_timeout` (connection) and `response_timeout` (time to
            //first response byte). Deliberately do NOT set `read_timeout`: needle's read-timer is re-armed on
            //every chunk and, in the digest-auth retry path, a read-timer can be left running after the request
            //has already completed — it later fires `request.destroy()` and emits a spurious error, and (worse)
            //keeps the Node event loop alive so a process that only made roku-deploy requests never exits.
            open_timeout: params.timeout,
            response_timeout: params.timeout,
            headers: params.headers
        };

        //`request` was configured with `agentOptions: { keepAlive: false }` so each exchange used a fresh
        //socket that closed when done. needle does NOT honor `agentOptions`, and on modern Node it does not
        //send `Connection: close` by default, so the socket to the Roku is left open (keep-alive) after the
        //response. That lingering socket keeps the Node event loop alive, so a process that only made
        //roku-deploy requests never exits. Translate the old keepAlive:false intent into needle's
        //`connection: 'close'` so needle sends `Connection: close` and tears the socket down after each
        //response. Only skip this if the caller explicitly asked to keep the connection alive.
        if (params.agentOptions?.keepAlive !== true) {
            needleOptions.connection = 'close';
        }

        //digest auth. `request` was configured with `auth.sendImmediately: false`, which performs the
        //401-challenge/response digest dance. needle does the same when `auth: 'digest'` is set.
        const auth = params.auth;
        if (auth) {
            needleOptions.username = auth.user ?? auth.username;
            needleOptions.password = auth.pass ?? auth.password;
            needleOptions.auth = 'digest';
        }

        let data: any = null;
        if (method === 'POST') {
            const formData = this.translateFormData(params.formData);
            //only send a multipart body when there's actually form data to send. Some POSTs (e.g. ECP
            //keypress) have no body at all; needle's multipart builder throws "Empty multipart body" on an
            //empty object, whereas `request` happily sent a bodyless POST. So fall back to a null body.
            if (Object.keys(formData).length > 0) {
                data = formData;
                needleOptions.multipart = true;
            }
        }

        return { url: url, data: data, needleOptions: needleOptions };
    }

    /**
     * Append the `qs` query-string object (if any) onto the url. `request` accepted
     * `qs` as a separate option; needle expects it baked into the url.
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
     * Convert a `request`-style `formData` object into the shape needle's multipart
     * builder understands.
     *
     * - `request` silently dropped `null`/`undefined`/empty-string fields. needle's
     *   multipart builder instead throws `"value missing for multipart!"` on empty
     *   values, so we drop those fields entirely (preserving the old behavior).
     * - `request` accepted a readable stream (e.g. the zip `fs.ReadStream`) as a
     *   field value. needle's multipart builder does not handle streams, so we
     *   translate a stream into needle's documented `{ file, content_type }` form
     *   using the stream's `path`.
     */
    private translateFormData(formData: Record<string, any> | undefined): Record<string, any> {
        const result: Record<string, any> = {};
        if (!formData) {
            return result;
        }
        for (const key in formData) {
            const value = formData[key];
            //drop empty values (request did this implicitly; needle would throw)
            if (value === undefined || value === null || value === '') {
                continue;
            }
            //a readable stream (the zip/pkg archive) -> needle file-by-path form
            if (this.isReadableStream(value)) {
                const filePath = (value).path;
                result[key] = {
                    file: filePath,
                    content_type: 'application/octet-stream'
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
     * Coerce needle's response body into the `string` that roku-deploy expects.
     * With `parse_response: false`, needle hands back a `Buffer` (an *empty* Buffer
     * for empty responses such as a bare 401), whereas `request`/`postman-request`
     * always delivered a decoded string. roku-deploy's `checkRequest` guards on
     * `typeof body === 'string'`, so anything other than a string would be
     * misreported as an unparsable response.
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
     * Reshape needle's response into the `request`-compatible response roku-deploy expects (and attaches
     * to thrown errors).
     *
     * Maximum-parity strategy: needle's callback `resp` is the *same* underlying Node
     * `http.IncomingMessage` that `postman-request` exposed (needle just augments it with `.body`/`.raw`/
     * `.bytes`). So rather than fabricate a minimal plain object — which would drop everything underneath
     * (`statusCode`/`statusMessage`/`rawHeaders`/`httpVersion*`/`socket`/`req`/`complete`/... that a
     * consumer might reach into) — we KEEP needle's IncomingMessage and only layer on the two things
     * `request`/`postman-request` added on top of it:
     *   1. a `.request` object exposing the outgoing-request fields consumers read (`host`, `href`, ...),
     *   2. a string `.body` (postman put the decoded string here; needle leaves a Buffer under
     *      `parse_response:false`).
     * This way the vast majority of the old response's reachable surface is reproduced for free.
     */
    private buildResponse(needleResponse: any, url: string, body: string): RequestResponse {
        //`request`/`postman-request` could hand back a callback with no response object; roku-deploy's
        //`checkRequest` explicitly guards on `!results.response`. Preserve that by passing through a missing
        //response rather than throwing while trying to augment it.
        if (!needleResponse) {
            return undefined;
        }

        //Parse with the legacy `url.parse()` to match postman-request's `response.request.uri` exactly: it
        //was a Node `Url` object (host WITH port, plus auth/hash/query/search/slashes/protocol/port). The
        //WHATWG `URL` would strip the default `:80` and omit these fields, so we deliberately use the legacy
        //parser here for byte-parity with what consumers read off `response.request.uri.*`.
        //`url.parse()` is total for string input (it never throws — a bare token like 'not-a-valid-url'
        //yields null host/hostname and the token as path/pathname), so no try/catch is needed.
        const u = urlModule.parse(url);
        const uri: Record<string, any> = {
            protocol: u.protocol,
            slashes: u.slashes,
            auth: u.auth,
            host: u.host,
            port: u.port,
            hostname: u.hostname,
            hash: u.hash,
            search: u.search,
            query: u.query,
            pathname: u.pathname,
            path: u.path,
            href: u.href
        };

        //needle's resp IS the http.IncomingMessage. Augment it in place to mirror postman-request's shape.
        const response = needleResponse;

        //`request`/`postman-request` attached the (string) body to `response.body`. needle leaves a Buffer
        //here under parse_response:false, so overwrite with the decoded string to match.
        response.body = body;

        //`request`/`postman-request` exposed its outgoing `Request` object at `response.request`. Its
        //library-internal guts (`_auth`, `_form`, `_qs`, `httpModule`, `pool`, ...) can't exist without the
        //`request` package, but we reproduce every CONSUMABLE field a caller could portably read. Don't
        //clobber it if needle/Node ever populates one.
        if (!response.request) {
            const outgoingHeaders = this.titleCaseHeaders(response.req?.getHeaders?.());
            response.request = {
                uri: uri,
                method: response.req?.method ?? undefined,
                headers: outgoingHeaders,
                host: uri.hostname,
                href: uri.href,
                path: uri.path,
                port: uri.port ?? undefined,
                originalHost: uri.hostname,
                originalHostHeaderName: 'Host',
                protocol: uri.protocol,
                readable: true,
                writable: true
            };
        }

        return response as RequestResponse;
    }

    /**
     * Wrap a needle stream so that an intermediate `401` `'response'` event (the
     * digest challenge that needle answers by retrying) is not propagated to
     * listeners. Only the subsequent, authenticated response is forwarded.
     */
    private interceptIntermediate401(stream: { emit: (event: string, ...args: any[]) => boolean }) {
        const originalEmit = stream.emit.bind(stream);
        let swallowedChallenge = false;
        stream.emit = ((event: string, ...args: any[]): boolean => {
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

    /**
     * Title-case an HTTP header name the way `request`/`postman-request` preserved it on the outgoing
     * request (`Content-Type`, `User-Agent`, `WWW-Authenticate`, ...). needle lowercases outgoing header
     * names, so we re-case them to maximize parity with what consumers saw on `response.request.headers`.
     */
    private titleCaseHeaderName(name: string): string {
        //title-case each hyphen-delimited segment (Content-Type, User-Agent, Authorization, ...). This
        //covers the outgoing request headers roku-deploy sends; we don't special-case acronym headers
        //(WWW-Authenticate etc.) because those are response headers, not outgoing-request headers.
        return name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join('-');
    }

    private titleCaseHeaders(headers: Record<string, any> | undefined): Record<string, any> | undefined {
        if (!headers || typeof headers !== 'object') {
            return headers;
        }
        const out: Record<string, any> = {};
        for (const key of Object.keys(headers)) {
            out[this.titleCaseHeaderName(key)] = headers[key];
        }
        return out;
    }
}

export const request = new Request();

/**
 * The subset of the legacy `request`/`postman-request` options object that roku-deploy actually
 * builds and this shim consumes. We previously typed these as `request.OptionsWithUrl` (from
 * `@types/request`), but that pulled a dependency purely for a type and forced `as any` reads for the
 * fields the `@types/request` surface didn't cleanly expose. Declaring exactly what we use lets us drop
 * `@types/request` entirely and read every field type-safely.
 */
export interface RequestOptions {

    /** The full request url (already includes host/port/path). */
    url: string;

    /** Per-request timeout in ms (connection + first-response-byte). */
    timeout?: number;

    /** Outgoing request headers. */
    headers?: Record<string, any>;

    /** Digest-auth credentials. `sendImmediately: false` requests the 401-challenge/response dance. */
    auth?: {
        user?: string;
        username?: string;
        pass?: string;
        password?: string;
        sendImmediately?: boolean;
    };

    /** multipart/form-data fields (string values, or a readable stream for the zip/pkg archive). */
    formData?: Record<string, any>;

    /** Query-string object appended to the url. */
    qs?: Record<string, any>;

    /**
     * Legacy `request` agent options. Only `keepAlive` is consulted: `request` used
     * `{ keepAlive: false }` so each exchange used a fresh socket that closed when done.
     */
    agentOptions?: {
        keepAlive?: boolean;
    };
}

/**
 * The `response` object roku-deploy (and its consumers) see. Both `postman-request` and `needle`
 * hand back a Node `http.IncomingMessage`, so the real object carries far more than the few fields
 * roku-deploy reads — `statusCode`, `headers`, `statusMessage`, `rawHeaders`, `httpVersion*`,
 * `socket`, `req`, `complete`, etc. We keep all of that (it's needle's actual IncomingMessage) and
 * layer on the `request`-compat extras postman added. The interface therefore declares the fields we
 * guarantee, and allows the rest of the IncomingMessage surface via the index signature.
 */
export interface RequestResponse {
    statusCode: number;
    headers: Record<string, any>;

    /**
     * Mirrors `request`'s `response.request` object. roku-deploy reads `response.request.host` when
     * constructing the "Unauthorized" error message; other consumers may read `href`/`uri`/`method`.
     */
    request: {
        host: string;
        href: string;
        uri?: Record<string, any>;
        method?: string;
        headers?: Record<string, any>;

        /** Plus the other consumable `request` fields we reproduce (path, port, protocol, ...). */
        [key: string]: any;
    };

    /**
     * The response body, as a string. `request`/`postman-request` attached the body to
     * `response.body` in addition to returning it as the callback's 3rd argument, so we mirror that
     * for callers that read `error.results.response.body`.
     */
    body: string;

    /** Plus the rest of the underlying http.IncomingMessage surface (statusMessage, rawHeaders, ...). */
    [key: string]: any;
}

export type RequestCallback = (error: Error | null, response: RequestResponse | undefined, body: string | undefined) => void;
