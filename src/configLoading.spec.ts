import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
import { logger } from '@rokucommunity/logger';
import { RokuDeploy, rokuDeploy } from './index';
import { InvalidOptionError } from './Errors';
import { loadCommandOptions } from './commands/commandUtils';
import { tempDir } from './testUtils.spec';
import { standardizePath as s } from './util';

const sinon = createSandbox();

/**
 * The constructor's `config` option and the CLI's loadCommandOptions are two doors into the same
 * config file. Every scenario here runs through both and expects the same answer.
 */
describe('config loading parity (constructor vs CLI)', () => {
    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        //the constructor resolves against process.cwd(); the CLI against --cwd. Point both at tempDir.
        sinon.stub(process, 'cwd').returns(tempDir);
        sinon.stub(console, 'log');
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.removeSync(tempDir);
    });

    //strip the CLI-only bookkeeping the loader adds, so the two results can be compared directly
    function viaCli(args: Record<string, any>) {
        const { cwd, ...options } = loadCommandOptions({ cwd: tempDir, ...args });
        return options;
    }
    function viaConstructor(options: Record<string, any>) {
        return new RokuDeploy(options)['options'];
    }

    it('both read the default rokudeploy.json from cwd', () => {
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { password: 'from-file', rootDir: './app' });
        expect(viaConstructor({ config: true })).to.eql({ password: 'from-file', rootDir: './app' });
        expect(viaCli({})).to.eql({ password: 'from-file', rootDir: './app' });
    });

    it('both yield only the explicit values when there is no file', () => {
        expect(viaConstructor({ config: true, password: 'explicit' })).to.eql({ password: 'explicit' });
        expect(viaCli({ password: 'explicit' })).to.eql({ password: 'explicit' });
    });

    it('both let an explicit value beat the file', () => {
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { password: 'from-file', username: 'from-file' });
        expect(viaConstructor({ config: true, password: 'explicit' })).to.eql({ password: 'explicit', username: 'from-file' });
        expect(viaCli({ password: 'explicit' })).to.eql({ password: 'explicit', username: 'from-file' });
    });

    it('both read a named file, resolving a relative path against cwd', () => {
        fsExtra.outputJsonSync(`${tempDir}/configs/deploy.json`, { password: 'named' });
        expect(viaConstructor({ config: 'configs/deploy.json' })).to.eql({ password: 'named' });
        expect(viaCli({ config: 'configs/deploy.json' })).to.eql({ password: 'named' });
    });

    it('both read a named file by absolute path', () => {
        fsExtra.outputJsonSync(`${tempDir}/elsewhere/deploy.json`, { password: 'absolute' });
        expect(viaConstructor({ config: s`${tempDir}/elsewhere/deploy.json` })).to.eql({ password: 'absolute' });
        expect(viaCli({ config: s`${tempDir}/elsewhere/deploy.json` })).to.eql({ password: 'absolute' });
    });

    it('both throw when a named file is missing', () => {
        expect(() => viaConstructor({ config: 'missing.json' })).to.throw(InvalidOptionError, 'Config file does not exist');
        expect(() => viaCli({ config: 'missing.json' })).to.throw(InvalidOptionError, 'Config file does not exist');
    });

    it('both throw on an unparseable file', () => {
        fsExtra.outputFileSync(`${tempDir}/rokudeploy.json`, '{ not json');
        expect(() => viaConstructor({ config: true })).to.throw(/Error parsing/);
        expect(() => viaCli({})).to.throw(/Error parsing/);
    });

    it('neither lets a config key inside the file leak into the options', () => {
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { password: 'x', config: 'other.json' });
        expect(viaConstructor({ config: true })).to.eql({ password: 'x' });
        expect(viaCli({})).to.eql({ password: 'x' });
    });

    it('both apply the file logLevel to the logger they use', () => {
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { logLevel: 'debug' });
        const myLogger = logger.createLogger();
        myLogger.logLevel = 'error';
        viaConstructor({ config: true, logger: myLogger });
        expect(myLogger.logLevel).to.equal('debug');
        rokuDeploy.logger.logLevel = 'error';
        viaCli({});
        expect(rokuDeploy.logger.logLevel).to.equal('debug');
    });

    it('both skip the file when told to', () => {
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { password: 'from-file' });
        expect(viaConstructor({ config: false, password: 'explicit' })).to.eql({ password: 'explicit' });
        expect(viaConstructor({ config: null, password: 'explicit' })).to.eql({ password: 'explicit' });
        expect(viaCli({ config: false, password: 'explicit' })).to.eql({ password: 'explicit' });
    });
});
