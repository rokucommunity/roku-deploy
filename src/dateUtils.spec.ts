import { expect } from 'chai';
import {
    formatTimestampForPackage,
    formatTimestampForScreenshot,
    formatLogTimestamp,
    parseMilliseconds
} from './dateUtils';

describe('dateUtils', () => {
    describe('formatTimestampForPackage', () => {
        it('formats as yymmddHHMM', () => {
            expect(formatTimestampForPackage(new Date('2026-06-29T14:30:45.123'))).to.equal('2606291430');
        });

        it('zero-pads single-digit month/day/hour/minute', () => {
            expect(formatTimestampForPackage(new Date('2026-01-05T09:08:07.004'))).to.equal('2601050908');
        });

        it('defaults to the current time', () => {
            expect(formatTimestampForPackage()).to.match(/^\d{10}$/);
        });
    });

    describe('formatTimestampForScreenshot', () => {
        it('formats as YYYY-MM-DD-HH.mm.ss.SSS', () => {
            expect(formatTimestampForScreenshot(new Date('2026-06-29T14:30:45.123'))).to.equal('2026-06-29-14.30.45.123');
        });

        it('zero-pads all components', () => {
            expect(formatTimestampForScreenshot(new Date('2026-01-05T09:08:07.004'))).to.equal('2026-01-05-09.08.07.004');
        });

        it('defaults to the current time', () => {
            expect(formatTimestampForScreenshot()).to.match(/^\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}\.\d{3}$/);
        });
    });

    describe('formatLogTimestamp', () => {
        it('formats afternoon times as PM with 12-hour clock', () => {
            expect(formatLogTimestamp(new Date('2026-06-29T14:30:45.123'))).to.equal('02:30:45:1230 PM');
        });

        it('formats morning times as AM', () => {
            expect(formatLogTimestamp(new Date('2026-06-29T09:08:07.004'))).to.equal('09:08:07:0040 AM');
        });

        it('renders midnight as 12 AM', () => {
            expect(formatLogTimestamp(new Date('2026-06-29T00:15:00.000'))).to.equal('12:15:00:0000 AM');
        });

        it('renders noon as 12 PM', () => {
            expect(formatLogTimestamp(new Date('2026-06-29T12:15:00.000'))).to.equal('12:15:00:0000 PM');
        });

        it('defaults to the current time', () => {
            expect(formatLogTimestamp()).to.match(/^\d{2}:\d{2}:\d{2}:\d{4} (AM|PM)$/);
        });
    });

    describe('parseMilliseconds', () => {
        it('breaks out hours, minutes, seconds, and milliseconds', () => {
            const parts = parseMilliseconds((17 * 60 * 1000) + (43 * 1000) + 30);
            expect(parts.minutes).to.equal(17);
            expect(parts.seconds).to.equal(43);
            expect(parts.milliseconds).to.equal(30);
        });

        it('handles whole days and hours', () => {
            const parts = parseMilliseconds((26 * 3600 * 1000));
            expect(parts.days).to.equal(1);
            expect(parts.hours).to.equal(2);
        });

        it('returns sub-millisecond components', () => {
            const parts = parseMilliseconds(0.5);
            expect(parts.milliseconds).to.equal(0);
            expect(parts.microseconds).to.equal(500);
            expect(parts.nanoseconds).to.equal(0);
        });
    });
});
