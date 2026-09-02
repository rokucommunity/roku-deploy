import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { PassThrough } from 'stream';
import * as needle from 'needle';
import { buildDigestAuthorization, parseDigestChallenge, request } from './request';

const sinon = createSandbox();

/**
 * Unit tests for the HTTP transport.
 *
 * These pin down the translation between roku-deploy's request options/`HttpResponse` and needle,
 * by stubbing `needle` directly. The response SHAPE here is part of roku-deploy's public surface
 * (it's attached to thrown errors), so getting any of this wrong is a breaking change.
 */
describe('request (http transport)', () => {

    /** captured args from the stubbed needle call: { url, data, options, callback } */
    let postArgs: { url: string; data: any; options: any; callback: any };
    let getArgs: { url: string; options: any; callback: any };
    let headArgs: { url: string; options: any; callback: any };

    /** Stub needle.post and capture/drive the callback */
    function stubPost(err: any, response: any, body: any) {
        return sinon.stub(needle, 'post').callsFake(((url: string, data: any, options: any, callback: any) => {
            postArgs = { url: url, data: data, options: options, callback: callback };
            //invoke async like needle does
            process.nextTick(callback, err, response, body);
            return {} as any;
        }) as any);
    }

    /** Stub needle.get (callback form) and capture/drive the callback */
    function stubGet(err: any, response: any, body: any) {
        return sinon.stub(needle, 'get').callsFake(((url: string, options: any, callback: any) => {
            getArgs = { url: url, options: options, callback: callback };
            if (callback) {
                process.nextTick(callback, err, response, body);
            }
            return new PassThrough() as any;
        }) as any);
    }

    /** Stub needle.head and capture/drive the callback */
    function stubHead(err: any, response: any, body: any) {
        return sinon.stub(needle, 'head').callsFake(((url: string, options: any, callback: any) => {
            headArgs = { url: url, options: options, callback: callback };
            process.nextTick(callback, err, response, body);
            return {} as any;
        }) as any);
    }

    /** Settle-capturing wrappers around the promise methods */
    async function callPost(params: any): Promise<{ error: any; response: any; body: any }> {
        try {
            const response = await request.post(params);
            return { error: null, response: response, body: response?.body };
        } catch (error) {
            return { error: error, response: undefined, body: undefined };
        }
    }
    async function callGet(params: any): Promise<{ error: any; response: any; body: any }> {
        try {
            const response = await request.get(params);
            return { error: null, response: response, body: response?.body };
        } catch (error) {
            return { error: error, response: undefined, body: undefined };
        }
    }
    async function callHead(params: any): Promise<{ error: any; response: any; body: any }> {
        try {
            const response = await request.head(params);
            return { error: null, response: response, body: response?.body };
        } catch (error) {
            return { error: error, response: undefined, body: undefined };
        }
    }

    afterEach(() => {
        sinon.restore();
        postArgs = undefined;
        getArgs = undefined;
        headArgs = undefined;
    });

    describe('option translation', () => {
        it('sets parse_response=false and maps timeout to open_timeout + response_timeout', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/plugin_install', timeout: 12345, formData: { a: 'b' } });
            expect(postArgs.options.parse_response).to.equal(false);
            expect(postArgs.options.open_timeout).to.equal(12345);
            expect(postArgs.options.response_timeout).to.equal(12345);
        });

        it('sets decode_response=false (needle charset-decoding corrupts binary downloads served with a charset)', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/plugin_package', formData: { a: 'b' } });
            expect(postArgs.options.decode_response).to.equal(false);
        });

        it('does NOT set read_timeout (its lingering re-armed timer leaks a handle in the digest-auth path)', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/plugin_install', timeout: 12345, formData: { a: 'b' } });
            expect(postArgs.options.read_timeout).to.be.undefined;
        });

        it('passes through headers', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', headers: { 'User-Agent': 'roku-deploy/test' }, formData: { a: 'b' } });
            expect(postArgs.options.headers).to.eql({ 'User-Agent': 'roku-deploy/test' });
        });

        it('closes the connection by default (needle keeps sockets alive otherwise, which pins the process)', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(postArgs.options.connection).to.equal('close');
            expect(postArgs.options.agent).to.equal(false);
        });

        it('closes the connection when keepAlive is explicitly false', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' }, keepAlive: false });
            expect(postArgs.options.connection).to.equal('close');
        });

        it('leaves the connection alone when the caller explicitly opts into keepAlive', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' }, keepAlive: true });
            expect(postArgs.options.connection).to.be.undefined;
            expect(postArgs.options.agent).to.be.undefined;
        });

        it('closes the connection by default on GET too', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            await callGet({ url: 'http://1.2.3.4:80/x' });
            expect(getArgs.options.connection).to.equal('close');
        });

        it('translates auth into digest username/password', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({
                url: 'http://1.2.3.4:80/x',
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { a: 'b' }
            });
            expect(postArgs.options.auth).to.equal('digest');
            expect(postArgs.options.username).to.equal('rokudev');
            expect(postArgs.options.password).to.equal('aaaa');
        });

        it('bakes the qs object into the url', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            await callGet({ url: 'http://1.2.3.4:80/plugin_install', qs: { dcl_enabled: '1', foo: 'bar' } });
            expect(getArgs.url).to.equal('http://1.2.3.4:80/plugin_install?dcl_enabled=1&foo=bar');
        });

        it('appends qs with & when the url already has a query string', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            await callGet({ url: 'http://1.2.3.4:80/x?already=1', qs: { more: '2' } });
            expect(getArgs.url).to.equal('http://1.2.3.4:80/x?already=1&more=2');
        });

        it('skips null/undefined qs values', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            await callGet({ url: 'http://1.2.3.4:80/x', qs: { keep: '1', drop: null, gone: undefined } });
            expect(getArgs.url).to.equal('http://1.2.3.4:80/x?keep=1');
        });

        it('leaves the url untouched when every qs value is null/undefined', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            await callGet({ url: 'http://1.2.3.4:80/x', qs: { drop: null, gone: undefined } });
            expect(getArgs.url).to.equal('http://1.2.3.4:80/x');
        });
    });

    describe('head', () => {
        it('issues a needle head request with the translated options', async () => {
            stubHead(null, { statusCode: 200, headers: {} }, Buffer.alloc(0));
            const { response } = await callHead({
                url: 'http://1.2.3.4:80/',
                timeout: 3000,
                auth: { username: 'rokudev', password: 'aaaa' }
            });
            expect(headArgs.url).to.equal('http://1.2.3.4:80/');
            expect(headArgs.options.open_timeout).to.equal(3000);
            expect(headArgs.options.auth).to.equal('digest');
            expect(response.statusCode).to.equal(200);
            expect(response.request.method).to.equal('HEAD');
        });
    });

    describe('formData / multipart translation', () => {
        it('enables multipart and passes form data when fields are present', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { mysubmit: 'Replace' } });
            expect(postArgs.options.multipart).to.equal(true);
            expect(postArgs.data).to.eql({ mysubmit: 'Replace' });
        });

        it('drops null/undefined/empty-string fields (needle throws on empty multipart values)', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({
                url: 'http://1.2.3.4:80/x',
                formData: { keep: 'yes', empty: '', nothing: null, missing: undefined }
            });
            expect(postArgs.data).to.eql({ keep: 'yes' });
        });

        it('does NOT enable multipart for a bodyless POST (e.g. ECP keypress)', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, '');
            await callPost({ url: 'http://1.2.3.4:8060/keypress/Home' });
            expect(postArgs.options.multipart).to.be.undefined;
            expect(postArgs.data).to.be.null;
        });

        it('does NOT enable multipart when all form fields were dropped', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, '');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { archive: '', mysubmit: null } });
            expect(postArgs.options.multipart).to.be.undefined;
            expect(postArgs.data).to.be.null;
        });

        it('translates a readable stream field into needle file-by-path form', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            //a fake fs.ReadStream-ish object
            const fakeStream: any = new PassThrough();
            fakeStream.path = '/tmp/archive.zip';
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { archive: fakeStream, mysubmit: 'Replace' } });
            expect(postArgs.data.archive).to.eql({ file: '/tmp/archive.zip', content_type: 'application/octet-stream' });
            expect(postArgs.data.mysubmit).to.equal('Replace');
        });
    });

    describe('raw body translation', () => {
        it('sends a string body verbatim without enabling multipart', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:8060/some/route', body: 'raw-body-string' });
            expect(postArgs.data).to.equal('raw-body-string');
            expect(postArgs.options.multipart).to.be.undefined;
        });

        it('sends a Buffer body verbatim without enabling multipart', async () => {
            const buffer = Buffer.from([0x00, 0x01, 0x02, 0xFF]);
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:8060/some/route', body: buffer });
            expect(postArgs.data).to.equal(buffer);
            expect(postArgs.options.multipart).to.be.undefined;
        });

        it('prefers a raw body over formData when both are set', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', body: 'raw', formData: { mysubmit: 'Replace' } });
            expect(postArgs.data).to.equal('raw');
            expect(postArgs.options.multipart).to.be.undefined;
        });

        it('preflights a bodied POST with credentials, sending the raw body only with the Authorization header', async () => {
            const CHALLENGE = 'Digest qop="auth", realm="rokudev", nonce="abc123"';
            const calls: Array<{ data: any; options: any }> = [];
            sinon.stub(needle, 'post').callsFake(((url: string, data: any, options: any, callback: any) => {
                const canned = calls.length === 0
                    ? { response: { statusCode: 401, headers: { 'www-authenticate': CHALLENGE } }, body: Buffer.alloc(0) }
                    : { response: { statusCode: 200, headers: {} }, body: 'ok' };
                calls.push({ data: data, options: options });
                process.nextTick(callback, null, canned.response, canned.body);
                return {} as any;
            }) as any);

            await callPost({
                url: 'http://1.2.3.4:80/some/route',
                auth: { username: 'rokudev', password: 'aaaa' },
                body: 'raw-body'
            });

            expect(calls).to.have.lengthOf(2);
            //the probe carries no body; the real request carries the raw body plus the computed digest header
            expect(calls[0].data).to.be.null;
            expect(calls[1].data).to.equal('raw-body');
            expect(calls[1].options.headers.authorization).to.match(/^Digest /);
        });
    });

    describe('body coercion', () => {
        it('coerces a Buffer body to a string', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, Buffer.from('hello world'));
            const { body } = await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(body).to.equal('hello world');
            expect(typeof body).to.equal('string');
        });

        it('coerces an empty Buffer (typical bare 401 body) to an empty string', async () => {
            stubPost(null, { statusCode: 401, headers: {} }, Buffer.alloc(0));
            const { body } = await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(body).to.equal('');
            expect(typeof body).to.equal('string');
        });

        it('passes a string body through unchanged', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, '<xml/>');
            const { body } = await callGet({ url: 'http://1.2.3.4:8060/query/device-info' });
            expect(body).to.equal('<xml/>');
        });

        it('coerces a null/undefined body to an empty string', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, null);
            const { body } = await callGet({ url: 'http://1.2.3.4:8060/x' });
            expect(body).to.equal('');
        });

        it('stringifies a non-string, non-buffer body (defensive fallback)', async () => {
            //parse_response:false should keep bodies as Buffers, but guard against a parsed value anyway
            stubGet(null, { statusCode: 200, headers: {} }, 1234 as any);
            const { body } = await callGet({ url: 'http://1.2.3.4:8060/x' });
            expect(body).to.equal('1234');
        });
    });

    describe('response shape', () => {
        it('carries statusCode, statusMessage, headers, string body, and the originating request', async () => {
            const headers = { 'content-length': '0', 'www-authenticate': 'Digest realm="rokudev"' };
            stubPost(null, { statusCode: 401, statusMessage: 'Unauthorized', headers: headers }, Buffer.alloc(0));
            const { response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                headers: { 'User-Agent': 'roku-deploy/test' },
                formData: { mysubmit: 'Delete' }
            });
            expect(response.statusCode).to.equal(401);
            expect(response.statusMessage).to.equal('Unauthorized');
            expect(response.headers).to.eql(headers);
            expect(response.body).to.equal('');
            expect(response.request.url).to.equal('http://1.2.3.4:80/plugin_install');
            expect(response.request.method).to.equal('POST');
            expect(response.request.host).to.equal('1.2.3.4');
            expect(response.request.headers).to.eql({ 'User-Agent': 'roku-deploy/test' });
        });

        it('sets request.method to GET for gets', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, '<device-info/>');
            const { response } = await callGet({ url: 'http://1.2.3.4:8060/query/device-info' });
            expect(response.request.method).to.equal('GET');
            expect(response.body).to.equal('<device-info/>');
        });

        it('defaults headers to an empty object when the underlying response has none', async () => {
            stubGet(null, { statusCode: 200 }, 'ok');
            const { response } = await callGet({ url: 'http://1.2.3.4:8060/x' });
            expect(response.headers).to.eql({});
        });

        it('leaves request.host undefined when the url cannot be parsed', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            const { response } = await callGet({ url: 'not-a-valid-url' });
            expect(response.request.host).to.be.undefined;
            expect(response.request.url).to.equal('not-a-valid-url');
        });

        it('rejects when needle delivers neither an error nor a response', async () => {
            stubPost(null, undefined, undefined);
            const { error, response } = await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(error?.message).to.include('No response received');
            expect(response).to.be.undefined;
        });
    });

    describe('digest preflight for bodied POSTs', () => {
        //needle's own digest dance sends the body on the unauthenticated first leg, which the Roku kills
        //mid-write for large bodies (write EPIPE). The transport therefore probes bodyless first and only
        //sends the body WITH a computed Authorization header. These tests pin that two-request sequence down.

        const CHALLENGE = 'Digest qop="auth", realm="rokudev", nonce="abc123"';

        /** Stub needle.post so each successive call gets the next canned result; returns the captured calls */
        function stubPostSequence(results: Array<{ error?: any; response?: any; body?: any }>) {
            const calls: Array<{ url: string; data: any; options: any }> = [];
            sinon.stub(needle, 'post').callsFake(((url: string, data: any, options: any, callback: any) => {
                const canned = results[Math.min(calls.length, results.length - 1)];
                calls.push({ url: url, data: data, options: options });
                process.nextTick(callback, canned.error ?? null, canned.response, canned.body);
                return {} as any;
            }) as any);
            return calls;
        }

        it('sends a bodyless credential-free probe, then the real request with a computed Authorization header', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 401, headers: { 'www-authenticate': CHALLENGE } }, body: Buffer.alloc(0) },
                { response: { statusCode: 200, headers: {} }, body: 'ok' }
            ]);
            const { error, response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { mysubmit: 'Replace' }
            });
            expect(calls).to.have.lengthOf(2);
            //the probe carries no body, no multipart flag, and no credentials (needle must not answer the challenge itself)
            expect(calls[0].data).to.be.null;
            expect(calls[0].options.multipart).to.be.undefined;
            expect(calls[0].options.username).to.be.undefined;
            expect(calls[0].options.auth).to.be.undefined;
            //the real request carries the body and the computed digest header
            expect(calls[1].data).to.eql({ mysubmit: 'Replace' });
            expect(calls[1].options.multipart).to.equal(true);
            const authorization = calls[1].options.headers.authorization as string;
            expect(authorization).to.match(/^Digest /);
            expect(authorization).to.include('username="rokudev"');
            expect(authorization).to.include('realm="rokudev"');
            expect(authorization).to.include('nonce="abc123"');
            expect(authorization).to.include('uri="/plugin_install"');
            expect(error).to.be.null;
            expect(response.statusCode).to.equal(200);
        });

        it('includes the query string in the digest uri', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 401, headers: { 'www-authenticate': CHALLENGE } }, body: Buffer.alloc(0) },
                { response: { statusCode: 200, headers: {} }, body: 'ok' }
            ]);
            await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                qs: { dcl_enabled: '1' },
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { mysubmit: 'Delete', fileName: 'a.zip' }
            });
            const authorization = calls[1].options.headers.authorization as string;
            expect(authorization).to.include('uri="/plugin_install?dcl_enabled=1"');
        });

        it('computes the Authorization header with an empty password when none was supplied', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 401, headers: { 'www-authenticate': CHALLENGE } }, body: Buffer.alloc(0) },
                { response: { statusCode: 200, headers: {} }, body: 'ok' }
            ]);
            const { error } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { username: 'rokudev' },
                formData: { mysubmit: 'Replace' }
            });
            expect(error).to.be.null;
            const authorization = calls[1].options.headers.authorization as string;
            expect(authorization).to.match(/^Digest /);
            expect(authorization).to.include('username="rokudev"');
        });

        it('sends the real request unchanged (credentials intact) when the probe is not a 401', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 200, headers: {} }, body: 'no auth required' }
            ]);
            const { error, response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { mysubmit: 'Replace' }
            });
            expect(calls).to.have.lengthOf(2);
            //no Authorization header was computed, and needle's own dance stays available as the fallback
            expect(calls[1].options.headers?.authorization).to.be.undefined;
            expect(calls[1].options.auth).to.equal('digest');
            expect(calls[1].options.username).to.equal('rokudev');
            expect(error).to.be.null;
            expect(response.statusCode).to.equal(200);
        });

        it('sends the real request unchanged when the 401 carries no challenge header', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 401, headers: {} }, body: Buffer.alloc(0) }
            ]);
            const { response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { mysubmit: 'Replace' }
            });
            expect(calls).to.have.lengthOf(2);
            expect(calls[1].options.headers?.authorization).to.be.undefined;
            //the real request's own response is what gets surfaced
            expect(response.statusCode).to.equal(401);
        });

        it('sends the real request unchanged when the probe yields no response at all', async () => {
            //needle can invoke its callback with neither an error nor a response; the preflight must not
            //blow up dereferencing it, and should fall back to needle's own 401 dance
            const calls = stubPostSequence([
                { response: undefined, body: undefined },
                { response: { statusCode: 200, headers: {} }, body: 'ok' }
            ]);
            const { response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { mysubmit: 'Replace' }
            });
            expect(calls).to.have.lengthOf(2);
            expect(calls[1].options.headers?.authorization).to.be.undefined;
            expect(response.statusCode).to.equal(200);
        });

        it('propagates a probe failure without sending the real request', async () => {
            const networkError = new Error('ECONNREFUSED');
            const calls = stubPostSequence([{ error: networkError }]);
            const { error, response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { username: 'rokudev', password: 'aaaa' },
                formData: { mysubmit: 'Replace' }
            });
            expect(calls).to.have.lengthOf(1);
            expect(error).to.equal(networkError);
            expect(response).to.be.undefined;
        });

        it('does NOT preflight a bodyless POST (e.g. ECP keypress with credentials)', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 200, headers: {} }, body: '' }
            ]);
            await callPost({
                url: 'http://1.2.3.4:8060/keypress/Home',
                auth: { username: 'rokudev', password: 'aaaa' }
            });
            expect(calls).to.have.lengthOf(1);
        });

        it('does NOT preflight a bodied POST without credentials', async () => {
            const calls = stubPostSequence([
                { response: { statusCode: 200, headers: {} }, body: 'ok' }
            ]);
            await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                formData: { mysubmit: 'Replace' }
            });
            expect(calls).to.have.lengthOf(1);
        });
    });

    describe('error passthrough', () => {
        it('rejects with the needle error (post)', async () => {
            const networkError = new Error('socket hang up');
            stubPost(networkError, undefined, undefined);
            const { error, response, body } = await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(error).to.equal(networkError);
            expect(response).to.be.undefined;
            expect(body).to.be.undefined;
        });

        it('rejects with the needle error (get)', async () => {
            const networkError = new Error('ECONNREFUSED');
            stubGet(networkError, undefined, undefined);
            const { error, response, body } = await callGet({ url: 'http://1.2.3.4:8060/x' });
            expect(error).to.equal(networkError);
            expect(response).to.be.undefined;
            expect(body).to.be.undefined;
        });
    });

    describe('getStream (file download path)', () => {
        it('returns the needle stream', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needle, 'get').returns(fakeStream as any);
            const result = request.getStream({ url: 'http://1.2.3.4:80/pkgs/dev.pkg', auth: { username: 'u', password: 'p' } });
            expect(result).to.equal(fakeStream);
        });

        it(`bridges needle's 'err' event to 'error'`, (done) => {
            const fakeStream = new PassThrough();
            sinon.stub(needle, 'get').returns(fakeStream as any);
            const stream: any = request.getStream({ url: 'http://1.2.3.4:80/x', auth: { username: 'u', password: 'p' } });
            const theError = new Error('stream blew up');
            stream.on('error', (e) => {
                expect(e).to.equal(theError);
                done();
            });
            fakeStream.emit('err', theError);
        });

        it('swallows the intermediate 401 response, then forwards the retried 200 (digest auth)', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needle, 'get').returns(fakeStream as any);
            const stream: any = request.getStream({ url: 'http://1.2.3.4:80/pkgs/dev.pkg', auth: { username: 'u', password: 'p' } });

            const seen: number[] = [];
            stream.on('response', (resp) => seen.push(resp.statusCode));

            //needle emits the digest challenge first, then the authenticated response
            fakeStream.emit('response', { statusCode: 401 });
            fakeStream.emit('response', { statusCode: 200 });

            //only the final 200 should have been surfaced
            expect(seen).to.eql([200]);
        });

        it('does NOT swallow a 401 when there is no digest auth (no credentials)', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needle, 'get').returns(fakeStream as any);
            const stream: any = request.getStream({ url: 'http://1.2.3.4:8060/x' });

            const seen: number[] = [];
            stream.on('response', (resp) => seen.push(resp.statusCode));
            fakeStream.emit('response', { statusCode: 401 });

            expect(seen).to.eql([401]);
        });

        it('forwards a response event that has no response object (digest auth)', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needle, 'get').returns(fakeStream as any);
            const stream: any = request.getStream({ url: 'http://1.2.3.4:80/x', auth: { username: 'u', password: 'p' } });

            let fired = false;
            stream.on('response', () => {
                fired = true;
            });
            //an undefined resp must not be mistaken for the 401 challenge to swallow
            fakeStream.emit('response', undefined);
            expect(fired).to.be.true;
        });
    });

    describe('parseDigestChallenge', () => {
        it('parses quoted values', () => {
            const parsed = parseDigestChallenge('Digest realm="rokudev", nonce="abc123", qop="auth"');
            expect(parsed).to.eql({ realm: 'rokudev', nonce: 'abc123', qop: 'auth' });
        });

        it('parses unquoted values', () => {
            const parsed = parseDigestChallenge('Digest realm=rokudev, algorithm=MD5, stale=false');
            expect(parsed).to.eql({ realm: 'rokudev', algorithm: 'MD5', stale: 'false' });
        });
    });

    describe('buildDigestAuthorization', () => {
        it('includes opaque parameter when present in challenge', () => {
            const authorization = buildDigestAuthorization({
                username: 'rokudev',
                password: 'password',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: {
                    realm: 'rokudev',
                    nonce: 'abc123',
                    qop: 'auth',
                    opaque: 'opaque-value'
                }
            });
            expect(authorization).to.match(/^Digest /);
            expect(authorization).to.include('opaque="opaque-value"');
            expect(authorization).to.include('qop=auth');
            expect(authorization).to.include('nc=00000001');
        });

        it('omits opaque parameter when not present in challenge', () => {
            const authorization = buildDigestAuthorization({
                username: 'rokudev',
                password: 'password',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: {
                    realm: 'rokudev',
                    nonce: 'abc123',
                    qop: 'auth'
                }
            });
            expect(authorization).to.not.include('opaque');
        });

        it('handles digest auth edge cases (MD5-SESS, missing qop, default algorithm, empty values)', () => {
            //MD5-SESS algorithm takes the session-key ha1 branch
            const md5Sess = buildDigestAuthorization({
                username: 'user',
                password: 'pass',
                method: 'HEAD',
                uri: '/x',
                challenge: { realm: 'r', nonce: 'n', algorithm: 'MD5-sess', qop: 'auth' }
            });
            expect(md5Sess).to.include('algorithm=MD5-SESS');

            //no qop: the response digest omits the nc/cnonce/qop segment entirely
            const noQop = buildDigestAuthorization({
                username: 'user',
                password: 'pass',
                method: 'HEAD',
                uri: '/x',
                challenge: { realm: 'r', nonce: 'n' }
            });
            expect(noQop).to.not.include('qop=');
            expect(noQop).to.not.include('nc=');

            //missing realm/nonce default to empty strings rather than throwing
            const emptyChallenge = buildDigestAuthorization({
                username: 'user',
                password: 'pass',
                method: 'HEAD',
                uri: '/x',
                challenge: {}
            });
            expect(emptyChallenge).to.include('realm=""');
            expect(emptyChallenge).to.include('nonce=""');
            expect(emptyChallenge).to.include('algorithm=MD5');
        });
    });
});
