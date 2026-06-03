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
        it('sets parse_response=false and maps timeout to both needle timeouts', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/plugin_install', timeout: 12345, formData: { a: 'b' } });
            expect(postArgs.options.parse_response).to.equal(false);
            expect(postArgs.options.open_timeout).to.equal(12345);
            expect(postArgs.options.read_timeout).to.equal(12345);
        });

        it('passes through headers', async () => {
            stubPost(null, { statusCode: 200, headers: {} }, 'ok');
            await callPost({ url: 'http://1.2.3.4:80/x', headers: { 'User-Agent': 'roku-deploy/test' }, formData: { a: 'b' } });
            expect(postArgs.options.headers).to.eql({ 'User-Agent': 'roku-deploy/test' });
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
    });

    describe('response reshape (postman-request compatibility)', () => {
        it('exposes statusCode, headers, request.host and request.href', async () => {
            stubPost(null, { statusCode: 401, headers: { server: 'Roku' } }, '');
            const { response } = await callPost({ url: 'http://1.2.3.4:80/plugin_install', formData: { a: 'b' } });
            expect(response.statusCode).to.equal(401);
            expect(response.headers).to.eql({ server: 'Roku' });
            //request.host strips the default :80 (matches request's behavior / URL semantics)
            expect(response.request.host).to.equal('1.2.3.4');
            expect(response.request.href).to.equal('http://1.2.3.4:80/plugin_install');
        });

        it('keeps a non-default port in request.host', async () => {
            stubGet(null, { statusCode: 200, headers: {} }, 'ok');
            const { response } = await callGet({ url: 'http://1.2.3.4:8060/query/device-info' });
            expect(response.request.host).to.equal('1.2.3.4:8060');
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
    });
});
