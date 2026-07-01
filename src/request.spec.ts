import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { PassThrough } from 'stream';
import { request, needleClient } from './request';

const sinon = createSandbox();

/**
 * Unit tests for the needle compatibility shim.
 *
 * These pin down the translation between roku-deploy's `request`/`postman-request`-style
 * options/response and needle, by stubbing `needleClient` directly. The error/response SHAPE
 * here is part of roku-deploy's public surface (it's attached to thrown errors), so getting any
 * of this wrong is a breaking change.
 */
describe('request (needle shim)', () => {

    /** captured args from the stubbed needle call: { url, data, options, callback } */
    let postArgs: { url: string; data: any; options: any; callback: any };
    let getArgs: { url: string; options: any; callback: any };

    /** Stub needleClient.post and capture/drive the callback */
    function stubPost(err: any, response: any, body: any) {
        return sinon.stub(needleClient, 'post').callsFake(((url: string, data: any, options: any, callback: any) => {
            postArgs = { url: url, data: data, options: options, callback: callback };
            //invoke async like needle does
            process.nextTick(callback, err, response, body);
            return {} as any;
        }) as any);
    }

    /** Stub needleClient.get (callback form) and capture/drive the callback */
    function stubGet(err: any, response: any, body: any) {
        return sinon.stub(needleClient, 'get').callsFake(((url: string, options: any, callback: any) => {
            getArgs = { url: url, options: options, callback: callback };
            if (callback) {
                process.nextTick(callback, err, response, body);
            }
            return new PassThrough() as any;
        }) as any);
    }

    /** Promise wrapper around the callback-style shim methods */
    function callPost(params: any): Promise<{ error: any; response: any; body: any }> {
        return new Promise((resolve) => {
            request.post(params, (error, response, body) => resolve({ error: error, response: response, body: body }));
        });
    }
    function callGet(params: any): Promise<{ error: any; response: any; body: any }> {
        return new Promise((resolve) => {
            request.get(params, (error, response, body) => resolve({ error: error, response: response, body: body }));
        });
    }

    afterEach(() => {
        sinon.restore();
        postArgs = undefined;
        getArgs = undefined;
    });

    describe('option translation', () => {
        it('sets parse_response=false and maps timeout to open_timeout + response_timeout', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/plugin_install', timeout: 12345, formData: { a: 'b' } });
            expect(postArgs.options.parse_response).to.equal(false);
            expect(postArgs.options.open_timeout).to.equal(12345);
            expect(postArgs.options.response_timeout).to.equal(12345);
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
        });

        it('closes the connection when agentOptions.keepAlive is false (request parity)', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' }, agentOptions: { keepAlive: false } });
            expect(postArgs.options.connection).to.equal('close');
        });

        it('leaves the connection alone when the caller explicitly opts into keepAlive', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' }, agentOptions: { keepAlive: true } });
            expect(postArgs.options.connection).to.be.undefined;
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
                auth: { user: 'rokudev', pass: 'aaaa', sendImmediately: false },
                formData: { a: 'b' }
            });
            expect(postArgs.options.auth).to.equal('digest');
            expect(postArgs.options.username).to.equal('rokudev');
            expect(postArgs.options.password).to.equal('aaaa');
        });

        it('accepts auth specified as username/password (request alias)', async () => {
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

    describe('formData / multipart translation', () => {
        it('enables multipart and passes form data when fields are present', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', formData: { mysubmit: 'Replace' } });
            expect(postArgs.options.multipart).to.equal(true);
            expect(postArgs.data).to.eql({ mysubmit: 'Replace' });
        });

        it('drops null/undefined/empty-string fields (request did this implicitly)', async () => {
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

    describe('response reshape (postman-request compatibility)', () => {
        it('guarantees the request-compat fields on the response (verified against postman-request 3.17.6)', async () => {
            //For maximum parity the shim returns needle's underlying http.IncomingMessage (so consumers
            //keep access to statusCode/statusMessage/rawHeaders/httpVersion/req/socket/... just like with
            //postman-request) and layers on the `request`-compat extras postman added. We therefore
            //assert the GUARANTEED fields are present/correct rather than deep-equaling the whole object
            //(it legitimately carries the full IncomingMessage surface, which we intentionally preserve).
            const headers = { 'content-length': '0', 'www-authenticate': 'Digest realm="rokudev"' };
            stubPost(null, { statusCode: 401, headers: headers }, Buffer.alloc(0));
            const { response } = await callPost({
                url: 'http://1.2.3.4:80/plugin_install',
                auth: { user: 'rokudev', pass: 'aaaa' },
                formData: { mysubmit: 'Delete', archive: '' }
            });
            expect(response.statusCode).to.equal(401);
            expect(response.headers).to.eql({ 'content-length': '0', 'www-authenticate': 'Digest realm="rokudev"' });
            //postman-request attached the (string) body to response.body too; the shim must match
            expect(response.body).to.equal('');
            //the request-compat object postman exposed at response.request
            expect(response.request.host).to.equal('1.2.3.4');
            expect(response.request.href).to.equal('http://1.2.3.4:80/plugin_install');
            expect(response.request.uri).to.include({
                host: '1.2.3.4:80',
                hostname: '1.2.3.4',
                port: '80',
                protocol: 'http:',
                href: 'http://1.2.3.4:80/plugin_install',
                pathname: '/plugin_install'
            });
        });

        it('attaches the string body to response.body (postman-request parity)', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, Buffer.from('<device-info/>'));
            const { response, body } = await callGet({ url: 'http://1.2.3.4:8060/query/device-info' });
            //the body is on BOTH the callback arg and response.body, and they're the same string
            expect(response.body).to.equal('<device-info/>');
            expect(response.body).to.equal(body);
        });

        it('exposes statusCode, headers, request.host and request.href', async () => {
            stubPost(null, { statusCode: 401, headers: { server: 'Roku' } }, '');
            const { response } = await callPost({ url: 'http://1.2.3.4:80/plugin_install', formData: { a: 'b' } });
            expect(response.statusCode).to.equal(401);
            expect(response.headers).to.eql({ server: 'Roku' });
            //request.host strips the default :80 (matches request's behavior / URL semantics)
            expect(response.request.host).to.equal('1.2.3.4');
            expect(response.request.href).to.equal('http://1.2.3.4:80/plugin_install');
        });

        it('populates request.method and request.headers from the underlying req when present', async () => {
            //needle's resp IS an http.IncomingMessage with a `.req` (ClientRequest). Simulate that so the
            //shim can surface the outgoing method/headers the way postman-request did.
            const fakeResp: any = {
                statusCode: 200,
                headers: {},
                req: {
                    method: 'POST',
                    getHeaders: () => ({ 'user-agent': 'roku-deploy/test' })
                }
            };
            stubGet(null, fakeResp, 'ok');
            const { response } = await callGet({ url: 'http://1.2.3.4:80/plugin_install' });
            expect(response.request.method).to.equal('POST');
            //needle lowercases outgoing header names; the shim re-cases them to match postman-request
            expect(response.request.headers).to.eql({ 'User-Agent': 'roku-deploy/test' });
        });

        it('does not clobber a pre-existing response.request', async () => {
            //if the underlying response already carries a `request` object, leave it untouched
            const preExisting = { host: 'pre.existing', href: 'http://pre.existing/x', custom: 'kept' };
            const fakeResp: any = { statusCode: 200, headers: {}, request: preExisting };
            stubGet(null, fakeResp, 'ok');
            const { response } = await callGet({ url: 'http://1.2.3.4:80/plugin_install' });
            expect(response.request).to.equal(preExisting);
            expect(response.request.custom).to.equal('kept');
        });

        it('leaves request.uri.hostname null when the url cannot be parsed (url.parse parity)', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            const { response } = await callGet({ url: 'not-a-valid-url' });
            //url.parse() of a bare token yields null host/hostname (this is what postman-request produced too)
            expect(response.request.host).to.be.null;
            expect(response.request.uri.hostname).to.be.null;
        });

        it('exposes the port via request.uri (host=hostname, uri.host=host:port) — postman-request parity', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            const { response } = await callGet({ url: 'http://1.2.3.4:8060/query/device-info' });
            //postman-request set response.request.host to the hostname only; the port lived on uri.host
            expect(response.request.host).to.equal('1.2.3.4');
            expect(response.request.uri.host).to.equal('1.2.3.4:8060');
            expect(response.request.uri.port).to.equal('8060');
        });

        it('passes the raw headers object through (so callers can read e.g. headers.server)', async () => {
            stubGet(null, { statusCode: 500, headers: { server: 'Apache', 'content-type': 'text/html' } }, 'body');
            const { response } = await callGet({ url: 'http://1.2.3.4:8060/query/device-info' });
            expect(response.headers.server).to.equal('Apache');
            expect(response.headers['content-type']).to.equal('text/html');
        });

        it('yields an undefined response (no crash) when needle delivers no response object', async () => {
            //request/postman-request could call back with no response; checkRequest guards on this.
            stubPost(null, undefined, undefined);
            const { error, response } = await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(error).to.be.null;
            expect(response).to.be.undefined;
        });

        it('still exposes the raw url as request.href when the url cannot be parsed', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            const { response } = await callGet({ url: 'not-a-valid-url' });
            expect(response.request.host).to.be.null;
            expect(response.request.href).to.equal('not-a-valid-url');
        });
    });

    describe('error passthrough', () => {
        it('forwards a needle error to the callback with undefined response/body (post)', async () => {
            const networkError = new Error('socket hang up');
            stubPost(networkError, undefined, undefined);
            const { error, response, body } = await callPost({ url: 'http://1.2.3.4:80/x', formData: { a: 'b' } });
            expect(error).to.equal(networkError);
            expect(response).to.be.undefined;
            expect(body).to.be.undefined;
        });

        it('forwards a needle error to the callback with undefined response/body (get)', async () => {
            const networkError = new Error('ECONNREFUSED');
            stubGet(networkError, undefined, undefined);
            const { error, response, body } = await callGet({ url: 'http://1.2.3.4:8060/x' });
            expect(error).to.equal(networkError);
            expect(response).to.be.undefined;
            expect(body).to.be.undefined;
        });
    });

    describe('streaming get (getToFile path)', () => {
        it('returns the needle stream when no callback is given', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needleClient, 'get').returns(fakeStream as any);
            const result = request.get({ url: 'http://1.2.3.4:80/pkgs/dev.pkg', auth: { user: 'u', pass: 'p' } } as any);
            expect(result).to.equal(fakeStream);
        });

        it(`bridges needle's 'err' event to 'error'`, (done) => {
            const fakeStream = new PassThrough();
            sinon.stub(needleClient, 'get').returns(fakeStream as any);
            const stream: any = request.get({ url: 'http://1.2.3.4:80/x', auth: { user: 'u', pass: 'p' } } as any);
            const theError = new Error('stream blew up');
            stream.on('error', (e) => {
                expect(e).to.equal(theError);
                done();
            });
            fakeStream.emit('err', theError);
        });

        it('swallows the intermediate 401 response, then forwards the retried 200 (digest auth)', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needleClient, 'get').returns(fakeStream as any);
            const stream: any = request.get({ url: 'http://1.2.3.4:80/pkgs/dev.pkg', auth: { user: 'u', pass: 'p' } } as any);

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
            sinon.stub(needleClient, 'get').returns(fakeStream as any);
            const stream: any = request.get({ url: 'http://1.2.3.4:8060/x' } as any);

            const seen: number[] = [];
            stream.on('response', (resp) => seen.push(resp.statusCode));
            fakeStream.emit('response', { statusCode: 401 });

            expect(seen).to.eql([401]);
        });

        it('forwards a response event that has no response object (digest auth)', () => {
            const fakeStream = new PassThrough();
            sinon.stub(needleClient, 'get').returns(fakeStream as any);
            const stream: any = request.get({ url: 'http://1.2.3.4:80/x', auth: { user: 'u', pass: 'p' } } as any);

            let fired = false;
            stream.on('response', () => {
                fired = true;
            });
            //an undefined resp must not be mistaken for the 401 challenge to swallow
            fakeStream.emit('response', undefined);
            expect(fired).to.be.true;
        });
    });
});
