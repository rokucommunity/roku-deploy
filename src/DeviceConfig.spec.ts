import { expect } from 'chai';
import {
    isLocalDeviceConfig,
    isRceDeviceConfig,
    isRceDeviceConfigByEsn,
    isRceDeviceConfigById,
    isRceDeviceConfigByUrl,
    validateDeviceConfig
} from './DeviceConfig';
import { isInvalidOptionError } from './Errors';

describe('DeviceConfig', () => {
    describe('isLocalDeviceConfig', () => {
        it('returns true for a local device config', () => {
            expect(isLocalDeviceConfig({ host: '1.2.3.4' })).to.be.true;
        });

        it('returns false for an RCE device config', () => {
            expect(isLocalDeviceConfig({ esn: 'ABC123' } as any)).to.be.false;
        });
    });

    describe('isRceDeviceConfig', () => {
        it('returns true for an esn-based RCE device config', () => {
            expect(isRceDeviceConfig({ esn: 'ABC123' } as any)).to.be.true;
        });

        it('returns true for an id-based RCE device config', () => {
            expect(isRceDeviceConfig({ id: 'device-1' } as any)).to.be.true;
        });

        it('returns true for an instanceUrl-based RCE device config', () => {
            expect(isRceDeviceConfig({ instanceUrl: 'https://example.com' } as any)).to.be.true;
        });

        it('returns false for a local device config', () => {
            expect(isRceDeviceConfig({ host: '1.2.3.4' })).to.be.false;
        });
    });

    describe('isRceDeviceConfigByEsn', () => {
        it('returns true when config has an esn', () => {
            expect(isRceDeviceConfigByEsn({ esn: 'ABC123' })).to.be.true;
        });

        it('returns false when config does not have an esn', () => {
            expect(isRceDeviceConfigByEsn({ id: 'device-1' } as any)).to.be.false;
        });
    });

    describe('isRceDeviceConfigById', () => {
        it('returns true when config has an id', () => {
            expect(isRceDeviceConfigById({ id: 1 })).to.be.true;
        });

        it('returns false when config does not have an id', () => {
            expect(isRceDeviceConfigById({ esn: 'ABC123' } as any)).to.be.false;
        });
    });

    describe('isRceDeviceConfigByUrl', () => {
        it('returns true when config has an instanceUrl', () => {
            expect(isRceDeviceConfigByUrl({ instanceUrl: 'https://example.com' })).to.be.true;
        });

        it('returns false when config does not have an instanceUrl', () => {
            expect(isRceDeviceConfigByUrl({ esn: 'ABC123' } as any)).to.be.false;
        });
    });

    describe('validateDeviceConfig', () => {
        it('does not throw for a host-only config', () => {
            expect(() => validateDeviceConfig({ host: '1.2.3.4' })).to.not.throw();
        });

        it('does not throw for an esn-only config', () => {
            expect(() => validateDeviceConfig({ esn: 'ABC123' })).to.not.throw();
        });

        it('does not throw for an id-only config, even when id is 0', () => {
            expect(() => validateDeviceConfig({ id: 0 })).to.not.throw();
        });

        it('does not throw for an instanceUrl-only config', () => {
            expect(() => validateDeviceConfig({ instanceUrl: 'https://example.com' })).to.not.throw();
        });

        it('does not throw when rceToken accompanies a single identifier', () => {
            expect(() => validateDeviceConfig({ esn: 'ABC123', rceToken: 'token' })).to.not.throw();
        });

        it('throws for a config with no identifiers', () => {
            expect(() => validateDeviceConfig({})).to.throw(
                'Device config must specify exactly one targeting identifier: host, esn, id, or instanceUrl'
            );
        });

        it('throws for a config with multiple identifiers', () => {
            expect(() => validateDeviceConfig({ host: '1.2.3.4', esn: 'ABC123' } as any)).to.throw(
                'Device config specifies multiple targeting identifiers (host, esn); exactly one of host, esn, id, or instanceUrl is allowed'
            );
        });

        it('throws for a config with id, esn, and instanceUrl all present', () => {
            expect(() => validateDeviceConfig({ id: 1, esn: 'ABC123', instanceUrl: 'https://example.com' } as any)).to.throw(
                'Device config specifies multiple targeting identifiers (esn, id, instanceUrl); exactly one of host, esn, id, or instanceUrl is allowed'
            );
        });

        it('throws an InvalidOptionError', () => {
            try {
                validateDeviceConfig({});
                expect.fail('Expected validateDeviceConfig to throw');
            } catch (e) {
                expect(isInvalidOptionError(e)).to.be.true;
            }
        });
    });
});
