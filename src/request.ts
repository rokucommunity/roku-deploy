/* eslint-disable camelcase */
import * as needle from 'needle';
import type { ReadStream } from 'fs';
import type * as requestType from 'request';

/**
 * Module seam for needle so tests can stub the underlying HTTP calls and assert
 * that the shim translates options and reshapes responses correctly. Mirrors the
 * `httpClient` seam in `fetch.ts`.
 */
export const needleClient = {
    post: needle.post.bind(needle),
    get: needle.get.bind(needle)
};

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

/**
 * The `response` object roku-deploy expects. `request` returned an
 * `http.IncomingMessage` augmented with a `.request` property exposing the
 * outgoing request details. needle exposes the outgoing request as `.req`
 * instead and does not attach a `.request` object, so we synthesize the few
 * fields that roku-deploy actually reads (currently just `request.host`).
 */
export interface RequestResponse {
    statusCode: number;
    headers: Record<string, any>;
    /**
     * Mirrors `request`'s `response.request` object. roku-deploy reads
     * `response.request.host` when constructing the "Unauthorized" error message.
     */
    request: {
        host: string;
        href: string;
    };
    /**
     * The response body, as a string. `request`/`postman-request` attached the body to
     * `response.body` in addition to returning it as the callback's 3rd argument, so we mirror that
     * for callers that read `error.results.response.body`.
     */
    body: string;
}

export type RequestCallback = (error: Error | null, response: RequestResponse | undefined, body: string | undefined) => void;

/**
 * Translate the `request`-style options object that roku-deploy builds into the
 * `(url, data, needleOptions)` triple that needle expects.
 */
function translateOptions(params: requestType.OptionsWithUrl, method: 'GET' | 'POST') {
    const url = buildUrl(params);

    const needleOptions: needle.NeedleOptions = {
        //Roku responses are HTML/XML that roku-deploy parses by hand; never let needle auto-parse them
        parse_response: false,
        //request had a single `timeout` that covered the whole exchange; map it to both needle timeouts
        open_timeout: params.timeout,
        read_timeout: params.timeout,
        headers: params.headers as Record<string, any>
    };

    //digest auth. `request` was configured with `auth.sendImmediately: false`, which performs the
    //401-challenge/response digest dance. needle does the same when `auth: 'digest'` is set.
    const auth = params.auth as { user?: string; username?: string; pass?: string; password?: string } | undefined;
    if (auth) {
        needleOptions.username = auth.user ?? auth.username;
        needleOptions.password = auth.pass ?? auth.password;
        needleOptions.auth = 'digest';
    }

    let data: any = null;
    if (method === 'POST') {
        const formData = translateFormData((params as any).formData);
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
function buildUrl(params: requestType.OptionsWithUrl): string {
    let url = params.url as string;
    const qs = (params as any).qs as Record<string, any> | undefined;
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
function translateFormData(formData: Record<string, any> | undefined): Record<string, any> {
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
        if (isReadableStream(value)) {
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

function isReadableStream(value: any): value is ReadStream {
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
function coerceBody(body: any): string {
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
 * Reshape needle's response object into the `request`-compatible response that
 * roku-deploy expects to receive (and to find attached to thrown errors).
 */
function buildResponse(needleResponse: any, url: string, body: string): RequestResponse {
    //`request`/`postman-request` could hand back a callback with no response object; roku-deploy's
    //`checkRequest` explicitly guards on `!results.response`. Preserve that by passing through a missing
    //response rather than throwing while trying to reshape it.
    if (!needleResponse) {
        return undefined;
    }
    let host: string;
    try {
        host = new URL(url).host;
    } catch {
        host = undefined;
    }
    return {
        statusCode: needleResponse.statusCode,
        headers: needleResponse.headers,
        request: {
            host: host,
            href: url
        },
        //`request`/`postman-request` attached the (string) body to `response.body` as well as
        //returning it as the 3rd callback arg. Mirror that so `error.results.response.body` matches.
        body: body
    };
}

export const request = {
    /**
     * POST a multipart/form-data request, `request`-style. Invokes `callback`
     * with `(error, response, body)`.
     */
    post: (params: requestType.OptionsWithUrl, callback: RequestCallback) => {
        const { url, data, needleOptions } = translateOptions(params, 'POST');
        return needleClient.post(url, data, needleOptions, (error, response, body) => {
            if (error) {
                return callback(error, undefined, undefined);
            }
            const coerced = coerceBody(body);
            return callback(null, buildResponse(response, url, coerced), coerced);
        });
    },

    /**
     * GET a request, `request`-style. With a `callback`, invokes it with
     * `(error, response, body)`. Without a callback, returns needle's readable
     * stream (which supports `.on('error'|'response', ...)` and `.pipe(...)`)
     * for the file-download path.
     */
    get: (params: requestType.OptionsWithUrl, callback?: RequestCallback) => {
        const { url, needleOptions } = translateOptions(params, 'GET');
        if (callback) {
            return needleClient.get(url, needleOptions, (error, response, body) => {
                if (error) {
                    return callback(error, undefined, undefined);
                }
                const coerced = coerceBody(body);
                return callback(null, buildResponse(response, url, coerced), coerced);
            });
        }
        //streaming form (no callback) - used by getToFile to pipe the response to disk.
        const stream = needleClient.get(url, needleOptions);

        //needle's stream emits its failures on the `'err'` event, but `request` (and roku-deploy's
        //getToFile) listens on `'error'`, so bridge `'err'` -> `'error'` to preserve that behavior.
        stream.on('err', (err) => stream.emit('error', err));

        //digest auth in streaming mode: needle issues the unauthenticated request, emits a `'response'`
        //for the 401 challenge, and *then* transparently retries with the Authorization header (emitting
        //a second `'response'`). `request`/`postman-request` only ever surfaced the final response, and
        //roku-deploy's `getToFile` treats any non-200 `'response'` as a hard failure. So when we're doing
        //digest auth, swallow the intermediate 401 `'response'` event and only forward the retried one.
        if (needleOptions.auth && needleOptions.username !== undefined) {
            interceptIntermediate401(stream);
        }
        return stream;
    }
};

/**
 * Wrap a needle stream so that an intermediate `401` `'response'` event (the
 * digest challenge that needle answers by retrying) is not propagated to
 * listeners. Only the subsequent, authenticated response is forwarded.
 */
function interceptIntermediate401(stream: { emit: (event: string, ...args: any[]) => boolean }) {
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
