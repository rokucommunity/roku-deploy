/* eslint-disable camelcase */
import * as needle from 'needle';
import * as urlModule from 'url';
import type { ReadStream } from 'fs';
import { buildDigestAuthorization, parseDigestChallenge } from './fetch';

/**
 * A thin compatibility shim over `needle` that mimics the slice of the `request`/`postman-request`
 * API that roku-deploy relies on — including the `results`/`response` shape attached to thrown
 * errors — so migrating off `postman-request` was non-breaking. Only `post` and `get` are
 * implemented; `get` also supports the callback-less streaming form used for file downloads.
 */
export class Request {

    /**
     * POST a multipart/form-data request, `request`-style. Invokes `callback`
     * with `(error, response, body)`.
     */
    public post(params: RequestOptions, callback: RequestCallback) {
        const { url, data, needleOptions } = this.translateOptions(params, 'POST');
        //needle's own digest flow sends the full body on the unauthenticated first leg, which the Roku
        //rejects mid-upload (`write EPIPE` on large zips) — so do the challenge dance ourselves, bodyless first
        if (data && needleOptions.auth === 'digest') {
            return this.postWithDigestPreflight(url, data, needleOptions, callback);
        }
        return needle.post(url, data, needleOptions, this.createNeedleCallback(url, callback));
    }

    /**
     * POST where the body is only ever sent WITH an Authorization header: a bodyless probe collects
     * the digest challenge, then the real request goes out pre-authorized. Falls back to needle's
     * own 401 dance if the probe yields no usable challenge.
     */
    private postWithDigestPreflight(url: string, data: any, needleOptions: needle.NeedleOptions, callback: RequestCallback) {
        //probe with no body and NO credentials: we want the raw 401 challenge back, not needle answering it
        //(which would consume the challenge before the real request could use it)
        const probeOptions: needle.NeedleOptions = { ...needleOptions };
        delete probeOptions.multipart;
        delete probeOptions.username;
        delete probeOptions.password;
        delete probeOptions.auth;

        return needle.post(url, null, probeOptions, (probeError, probeResponse) => {
            if (probeError) {
                return callback(probeError, undefined, undefined);
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
            needle.post(url, data, authorizedOptions, this.createNeedleCallback(url, callback));
        });
    }

    /**
     * Build the needle callback that reshapes `(error, response, body)` into the `request`-style
     * `(error, response, body)` the rest of roku-deploy consumes.
     */
    private createNeedleCallback(url: string, callback: RequestCallback) {
        return (error: Error | null, response: any, body: any) => {
            if (error) {
                return callback(error, undefined, undefined);
            }
            const coerced = this.coerceBody(body);
            return callback(null, this.buildResponse(response, url, coerced), coerced);
        };
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

        //needle's streaming digest auth emits a `'response'` for the intermediate 401 challenge before
        //retrying; `request` only surfaced the final response, so swallow the 401 and forward the retry
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
            //map `request`'s single `timeout` onto needle's connection and first-byte timeouts. Don't set
            //`read_timeout`: its re-armed timer can outlive a digest-auth retry and hang the process.
            open_timeout: params.timeout,
            response_timeout: params.timeout,
            headers: params.headers
        };

        //unlike `request`, needle pools keep-alive sockets, which keeps the process alive after we're done
        //and can reuse a socket the Roku already closed (ECONNRESET) — force a fresh socket that closes
        if (params.agentOptions?.keepAlive !== true) {
            needleOptions.connection = 'close';
            needleOptions.agent = false;
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
            //a raw body is written to the wire as-is (no multipart/urlencoding), for routes that read the raw request body
            if (params.body !== undefined && params.body !== null) {
                data = params.body;
            } else {
                const formData = this.translateFormData(params.formData);
                //only send a multipart body when there's actually form data to send. Some POSTs (e.g. ECP
                //keypress) have no body at all; needle's multipart builder throws "Empty multipart body" on an
                //empty object, whereas `request` happily sent a bodyless POST. So fall back to a null body.
                if (Object.keys(formData).length > 0) {
                    data = formData;
                    needleOptions.multipart = true;
                }
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
     * Convert a `request`-style `formData` object into needle's multipart shape: drop empty
     * fields (needle throws where `request` silently dropped them) and translate readable
     * streams into needle's `{ file, content_type }` file-by-path form.
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
     * Coerce needle's response body into the `string` roku-deploy expects: with `parse_response: false`
     * needle hands back a `Buffer`, and roku-deploy's `checkRequest` guards on `typeof body === 'string'`.
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
     * to thrown errors): keep needle's `http.IncomingMessage` and layer on `.request` and a string `.body`.
     */
    private buildResponse(needleResponse: any, url: string, body: string): RequestResponse {
        //`request`/`postman-request` could hand back a callback with no response object; roku-deploy's
        //`checkRequest` explicitly guards on `!results.response`. Preserve that by passing through a missing
        //response rather than throwing while trying to augment it.
        if (!needleResponse) {
            return undefined;
        }

        //use legacy `url.parse()` (which never throws) for byte-parity with postman-request's
        //`response.request.uri` Node `Url` object — WHATWG `URL` strips the default `:80` and omits fields
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

        //reproduce every consumable field of `request`'s `response.request` object. Don't clobber it
        //if needle/Node ever populates one.
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
     * Title-case an outgoing header name (`Content-Type`, `User-Agent`, ...): needle lowercases them,
     * but `request` preserved the casing consumers saw on `response.request.headers`.
     */
    private titleCaseHeaderName(name: string): string {
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
 * The subset of the legacy `request` options object that roku-deploy builds and this shim consumes.
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

    /** Raw POST body (string or Buffer), sent verbatim with no multipart framing. Takes precedence over `formData`. */
    body?: string | Buffer;

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
 * The `response` object roku-deploy (and its consumers) see: needle's actual `http.IncomingMessage`
 * plus the `request`-compat extras. Declares the fields we guarantee; the index signature allows
 * the rest of the IncomingMessage surface.
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
