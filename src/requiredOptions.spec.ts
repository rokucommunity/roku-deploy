import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
import { RokuDeploy } from './RokuDeploy';
import { MissingRequiredOptionError } from './Errors';
import { tempDir } from './testUtils.spec';
import { request } from './request';

const sinon = createSandbox();

/**
 * One row per public method that has required options: the options it needs, and a minimal set of values
 * that satisfies them. The same values are supplied once through the constructor and once per call.
 */
const rows: Array<{ method: string; required: string[]; values: Record<string, any> }> = [
    { method: 'zip', required: ['dir'], values: { dir: `${tempDir}/app` } },
    { method: 'sideload', required: ['device', 'password', 'zip'], values: { device: { host: '1.2.3.4' }, password: 'p', dir: `${tempDir}/app` } },
    { method: 'convertToSquashfs', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'createSignedPackage', required: ['device', 'password', 'signingPassword'], values: { device: { host: '1.2.3.4' }, password: 'p', signingPassword: 's' } },
    { method: 'rekeyDevice', required: ['device', 'password', 'pkg', 'signingPassword'], values: { device: { host: '1.2.3.4' }, password: 'p', pkg: `${tempDir}/app/signed.pkg`, signingPassword: 's' } },
    { method: 'getDeviceInfo', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'getEcpNetworkAccessMode', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'getDevId', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'captureScreenshot', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'rebootDevice', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'checkForUpdate', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'validateDeveloperPassword', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'sendEcpRequest', required: ['device', 'route'], values: { device: { host: '1.2.3.4' }, route: 'query/apps' } },
    { method: 'createEcpSocket', required: ['device', 'route'], values: { device: { host: '1.2.3.4' }, route: 'perfetto-session' } },
    { method: 'keyPress', required: ['device', 'key'], values: { device: { host: '1.2.3.4' }, key: 'Home' } },
    { method: 'keyDown', required: ['device', 'key'], values: { device: { host: '1.2.3.4' }, key: 'Home' } },
    { method: 'keyUp', required: ['device', 'key'], values: { device: { host: '1.2.3.4' }, key: 'Home' } },
    { method: 'sendText', required: ['device', 'text'], values: { device: { host: '1.2.3.4' }, text: 'hi' } },
    { method: 'sendKeySequence', required: ['device', 'keys'], values: { device: { host: '1.2.3.4' }, keys: ['Home'], keyDelay: 0 } },
    { method: 'launchApp', required: ['device', 'appId'], values: { device: { host: '1.2.3.4' }, appId: 'dev' } },
    { method: 'exitApp', required: ['device', 'appId'], values: { device: { host: '1.2.3.4' }, appId: 'dev' } },
    { method: 'closeChannel', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'getApps', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'getActiveApp', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'getRegistry', required: ['device', 'appId'], values: { device: { host: '1.2.3.4' }, appId: 'dev' } },
    { method: 'getAppState', required: ['device', 'appId'], values: { device: { host: '1.2.3.4' }, appId: 'dev' } },
    { method: 'getRendezvousTracking', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'setRendezvousTracking', required: ['device', 'enabled'], values: { device: { host: '1.2.3.4' }, enabled: true } },
    { method: 'enablePerfettoTracing', required: ['device', 'appId'], values: { device: { host: '1.2.3.4' }, appId: 'dev' } },
    { method: 'startPerfettoSession', required: ['device'], values: { device: { host: '1.2.3.4' } } },
    { method: 'triggerHeapSnapshot', required: ['device', 'appId'], values: { device: { host: '1.2.3.4' }, appId: 'dev' } },
    { method: 'deleteDevChannel', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'deleteAllSideloadedPlugins', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'deleteComponentLibrary', required: ['device', 'password', 'fileName'], values: { device: { host: '1.2.3.4' }, password: 'p', fileName: 'lib.zip' } },
    { method: 'deleteAllComponentLibraries', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'listSideloadedPlugins', required: ['device', 'password'], values: { device: { host: '1.2.3.4' }, password: 'p' } },
    { method: 'resolveFilesArray', required: ['rootDir', 'files'], values: { rootDir: `${tempDir}/app`, files: ['manifest'] } },
    { method: 'createSocket', required: ['device', 'port'], values: { device: { host: '1.2.3.4' }, port: 8085 } }
];

/**
 * Every public method that takes options validates them after merging the instance defaults, the device
 * registry and the per-call options, so the same error is raised no matter where a value was (not) supplied.
 */
describe('required options', () => {
    const networkStubbed = new Error('network stubbed');

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.outputFileSync(`${tempDir}/app/manifest`, '');
        fsExtra.outputFileSync(`${tempDir}/app/signed.pkg`, '');
        //nothing here may reach a device: every request primitive fails with a recognizable error
        sinon.stub(RokuDeploy.prototype as any, 'doGetRequest').rejects(networkStubbed);
        sinon.stub(RokuDeploy.prototype as any, 'doPostRequest').rejects(networkStubbed);
        sinon.stub(RokuDeploy.prototype as any, 'createWebSocket').throws(networkStubbed);
        //`request` is a class instance, so its methods live on the prototype
        for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(request)).filter(x => x !== 'constructor')) {
            sinon.stub(request as any, name).rejects(networkStubbed);
        }
    });

    afterEach(() => {
        sinon.restore();
        fsExtra.removeSync(tempDir);
    });

    /**
     * Run the method and return whatever it threw (undefined when it resolved).
     */
    async function thrownBy(rokuDeploy: RokuDeploy, method: string, options: any): Promise<any> {
        try {
            await (rokuDeploy as any)[method](options);
        } catch (e) {
            return e;
        }
    }

    for (const { method, required, values } of rows) {
        describe(method, () => {
            it('throws one error naming the method and every missing option when nothing supplies them', async () => {
                const e = await thrownBy(new RokuDeploy(), method, {});
                expect(e).to.be.instanceOf(MissingRequiredOptionError);
                expect(e.message).to.equal(`${method}: missing required option${required.length > 1 ? 's' : ''} ${required.map(x => `'${x}'`).join(', ')}`);
                expect(e.details).to.eql({ methodName: method, optionName: required[0], optionNames: required });
            });

            it('passes validation when the constructor supplies the values', async () => {
                const e = await thrownBy(new RokuDeploy(values as any), method, {});
                expect(e).not.to.be.instanceOf(MissingRequiredOptionError, e?.message);
            });

            it('passes validation when the call supplies the values', async () => {
                const e = await thrownBy(new RokuDeploy(), method, values);
                expect(e).not.to.be.instanceOf(MissingRequiredOptionError, e?.message);
            });
        });
    }

    it('sideload asks for a zip when neither a zip nor a dir is given, and accepts a dir in its place', async () => {
        const e = await thrownBy(new RokuDeploy({ device: { host: '1.2.3.4' }, password: 'p' }), 'sideload', {});
        expect(e).to.be.instanceOf(MissingRequiredOptionError);
        expect(e.message).to.equal(`sideload: missing required option 'zip'`);
        const withDir = await thrownBy(new RokuDeploy({ device: { host: '1.2.3.4' }, password: 'p' }), 'sideload', { dir: `${tempDir}/app` });
        expect(withDir).not.to.be.instanceOf(MissingRequiredOptionError, withDir?.message);
    });

    it('names the method when given one, and falls back to a plain message without it', () => {
        const rokuDeploy = new RokuDeploy();
        expect(() => rokuDeploy['checkRequiredOptions']({} as Record<string, any>, ['device', 'password']))
            .to.throw(MissingRequiredOptionError, `Missing required options 'device', 'password'`);
        expect(() => rokuDeploy['checkRequiredOptions']({} as Record<string, any>, ['device'], 'remote-control'))
            .to.throw(MissingRequiredOptionError, `remote-control: missing required option 'device'`);
    });

    it('stage has no required options', async () => {
        const e = await thrownBy(new RokuDeploy(), 'stage', { out: `${tempDir}/staging`, rootDir: `${tempDir}/app` });
        expect(e).to.be.undefined;
    });
});
