/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
import { expect } from 'chai';
import { createSandbox } from 'sinon';
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
});
