import { expect } from 'chai';
import { isLocalDeviceConfig, isRceDeviceConfig, isRceByEsn, isRceById, isRceByUrl } from './DeviceConfig';

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

    describe('isRceByEsn', () => {
        it('returns true when config has an esn', () => {
            expect(isRceByEsn({ esn: 'ABC123' })).to.be.true;
        });

        it('returns false when config does not have an esn', () => {
            expect(isRceByEsn({ id: 'device-1' } as any)).to.be.false;
        });
    });

    describe('isRceById', () => {
        it('returns true when config has an id', () => {
            expect(isRceById({ id: 'device-1' })).to.be.true;
        });

        it('returns false when config does not have an id', () => {
            expect(isRceById({ esn: 'ABC123' } as any)).to.be.false;
        });
    });

    describe('isRceByUrl', () => {
        it('returns true when config has an instanceUrl', () => {
            expect(isRceByUrl({ instanceUrl: 'https://example.com' })).to.be.true;
        });

        it('returns false when config does not have an instanceUrl', () => {
            expect(isRceByUrl({ esn: 'ABC123' } as any)).to.be.false;
        });
    });
});
