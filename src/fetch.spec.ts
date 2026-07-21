/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { buildDigestAuthorization } from './fetch';
const sinon = createSandbox();

describe('fetch module', () => {
    afterEach(() => {
        sinon.restore();
    });

    it('does not crash when globalThis.fetch is undefined (pre-Node-18)', () => {
        // Simulate a Node version that has no native fetch
        const original = (globalThis as any).fetch;
        delete (globalThis as any).fetch;
        try {
            // Re-require so the module-level initializer runs without fetch
            delete require.cache[require.resolve('./fetch')];
            expect(() => require('./fetch')).not.to.throw();
            const { httpClient } = require('./fetch');
            expect(httpClient.fetch).to.be.undefined;
        } finally {
            (globalThis as any).fetch = original;
            delete require.cache[require.resolve('./fetch')];
        }
    });

    it('binds globalThis.fetch when it is available', () => {
        const fakeFetch = sinon.stub().resolves(new Response());
        const original = (globalThis as any).fetch;
        (globalThis as any).fetch = fakeFetch;
        try {
            delete require.cache[require.resolve('./fetch')];
            const { httpClient } = require('./fetch');
            expect(httpClient.fetch).to.be.a('function');
        } finally {
            (globalThis as any).fetch = original;
            delete require.cache[require.resolve('./fetch')];
        }
    });

    describe('buildDigestAuthorization', () => {
        it('includes opaque parameter when present in challenge', () => {
            const result = buildDigestAuthorization({
                username: 'rokudev',
                password: 'aaaa',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: {
                    realm: 'rokudev',
                    nonce: 'abc123',
                    qop: 'auth',
                    opaque: 'xyz789'
                }
            });

            expect(result).to.include('opaque="xyz789"');
            expect(result).to.match(/^Digest /);
        });

        it('omits opaque parameter when not present in challenge', () => {
            const result = buildDigestAuthorization({
                username: 'rokudev',
                password: 'aaaa',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: {
                    realm: 'rokudev',
                    nonce: 'abc123',
                    qop: 'auth'
                }
            });

            expect(result).to.not.include('opaque');
        });

        it('handles digest auth edge cases (MD5-SESS, missing qop, default algorithm, empty values)', () => {
            //MD5-SESS algorithm
            const md5SessResult = buildDigestAuthorization({
                username: 'rokudev',
                password: 'aaaa',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: { realm: 'rokudev', nonce: 'abc123', qop: 'auth', algorithm: 'MD5-SESS' }
            });
            expect(md5SessResult).to.include('algorithm=MD5-SESS');
            expect(md5SessResult).to.match(/^Digest /);

            //missing qop parameter
            const noQopResult = buildDigestAuthorization({
                username: 'rokudev',
                password: 'aaaa',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: { realm: 'rokudev', nonce: 'abc123' }
            });
            expect(noQopResult).to.not.include('qop=');
            expect(noQopResult).to.not.include('nc=');
            expect(noQopResult).to.not.include('cnonce=');

            //defaults to MD5 algorithm when not specified
            const defaultAlgoResult = buildDigestAuthorization({
                username: 'rokudev',
                password: 'aaaa',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: { realm: 'rokudev', nonce: 'abc123', qop: 'auth' }
            });
            expect(defaultAlgoResult).to.include('algorithm=MD5');

            //empty realm and nonce
            const emptyValuesResult = buildDigestAuthorization({
                username: 'rokudev',
                password: 'aaaa',
                method: 'HEAD',
                uri: '/plugin_install',
                challenge: {}
            });
            expect(emptyValuesResult).to.include('realm=""');
            expect(emptyValuesResult).to.include('nonce=""');
        });
    });

    describe('parseDigestChallenge', () => {
        it('parses quoted values', () => {
            const { parseDigestChallenge } = require('./fetch');
            const result = parseDigestChallenge('Digest realm="rokudev", nonce="abc123"');

            expect(result.realm).to.equal('rokudev');
            expect(result.nonce).to.equal('abc123');
        });

        it('parses unquoted values', () => {
            const { parseDigestChallenge } = require('./fetch');
            const result = parseDigestChallenge('Digest realm=rokudev, qop=auth');

            expect(result.realm).to.equal('rokudev');
            expect(result.qop).to.equal('auth');
        });
    });
});
