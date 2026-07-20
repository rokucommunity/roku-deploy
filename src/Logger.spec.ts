import { expect } from 'chai';
import { LogLevel, Logger, noop } from './Logger';
import type { RokuDeployOptions } from './RokuDeployOptions';

describe('Logger compatibility shim', () => {
    it('exposes the same LogLevel member names and numeric values as the original enum', () => {
        expect(LogLevel.off).to.equal(0);
        expect(LogLevel.error).to.equal(1);
        expect(LogLevel.warn).to.equal(2);
        expect(LogLevel.log).to.equal(3);
        expect(LogLevel.info).to.equal(4);
        expect(LogLevel.debug).to.equal(5);
        expect(LogLevel.trace).to.equal(6);
    });

    it('LogLevel remains assignable to RokuDeployOptions logLevel (the old consumer pattern)', () => {
        //compile-time assertion: this is how consumers (e.g. brighterscript) pass the value
        const options: RokuDeployOptions = {
            logLevel: LogLevel.log
        };
        expect(options.logLevel).to.equal(LogLevel.log);
    });

    it('exposes a constructible Logger', () => {
        const logger = new Logger();
        expect(logger).to.be.ok;
    });

    it('noop does nothing', () => {
        expect(noop()).to.be.undefined;
    });
});
