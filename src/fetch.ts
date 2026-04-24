import * as crypto from 'crypto';

// Module seam for `fetch` so tests can stub it. On Node 18, `fetch` is a lazy
// getter on `globalThis` (not an own property), so `sinon.stub(globalThis, 'fetch')`
// fails there — routing calls through this object gives a regular, stubbable export.
export const httpClient = {
    fetch: globalThis.fetch.bind(globalThis)
};

/**
 * Issue an HTTP request with digest authentication.
 * Performs the two-step challenge/response dance: the first request
 * collects the `WWW-Authenticate` challenge, the second sends a computed
 * `Authorization` header. Response bodies are not consumed — callers get
 * the raw `Response` and inspect status/headers only.
 */
export async function fetchWithDigest(
    url: string,
    init: RequestInit & { method: string; username: string; password: string; timeout: number }
): Promise<Response> {
    const { username, password, timeout, ...fetchInit } = init;
    const method = fetchInit.method.toUpperCase();

    // Step 1 — issue the request unauthenticated to collect the challenge.
    const step1 = await fetchWithTimeout(url, fetchInit, timeout);
    if (step1.status !== 401) {
        return step1;
    }
    const wwwAuth = step1.headers.get('www-authenticate');
    if (!wwwAuth) {
        return step1;
    }

    // Step 2 — compute the digest response and retry.
    const challenge = parseDigestChallenge(wwwAuth);
    const uri = new URL(url).pathname;
    const authorization = buildDigestAuthorization({
        username: username,
        password: password,
        method: method,
        uri: uri,
        challenge: challenge
    });
    return fetchWithTimeout(url, {
        ...fetchInit,
        headers: { ...fetchInit.headers, Authorization: authorization }
    }, timeout);
}

function fetchWithTimeout(url: string, init: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return httpClient.fetch(url, { ...init, signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

//parse the comma-separated key/value pairs out of a `WWW-Authenticate: Digest ...` header. Values may be bare or double-quoted.
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

//build an RFC 2617 `Authorization: Digest ...` header from a parsed challenge.
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
