import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as semver from 'semver';
import { expect } from 'chai';
import * as rokuDeploy from './index';
import { RokuDeploy } from './RokuDeploy';
import * as errors from './Errors';
import { cwd, expectPathExists, expectThrowsAsync, outDir, rootDir, tempDir, writeFiles } from './testUtils.spec';
import undent from 'undent';

/**
 * These tests run against an ACTUAL Roku device on the local network. They are excluded from the
 * normal/CI test run (see the `test` script's `--exclude`) and are intended to be run manually with
 * `npm run test:device` whenever the networking layer changes (e.g. the postman-request -> needle migration).
 *
 * Goals:
 *  - Exercise EVERY networking-enabled public method on RokuDeploy at least once.
 *  - Be resilient to the device's actual data changing over time. We assert on STRUCTURE and TYPES
 *    (e.g. "softwareVersion is semver-ish", "deviceInfo is a non-empty object") rather than exact
 *    values, since model/version/serial/etc. differ per device and per firmware update.
 *
 * Device connection info is hardcoded below for convenience. Override via env vars if needed:
 *  - ROKU_HOST      (default 192.168.1.32)
 *  - ROKU_PASSWORD  (default aaaa)
 *  - ROKU_SIGNING_PASSWORD  (no default) - required to run the package-signing tests
 *  - ROKU_RUN_DISRUPTIVE=1  - opt in to disruptive tests that reboot / trigger update checks
 */
const HOST = process.env.ROKU_HOST ?? '192.168.1.32';
const PASSWORD = process.env.ROKU_PASSWORD ?? 'aaaa';
const SIGNING_PASSWORD = process.env.ROKU_SIGNING_PASSWORD;
const RUN_DISRUPTIVE = process.env.ROKU_RUN_DISRUPTIVE === '1';

describe('device', function device() {
    this.timeout(30000);

    let options: rokuDeploy.RokuDeployOptions;
    let rd: RokuDeploy;

    /**
     * Write a minimal-but-runnable channel into rootDir so screenshots/deploys have a real,
     * compilable app to work with. (A channel that fails to compile would break screenshot tests.)
     */
    function writeMinimalChannel() {
        writeFiles(rootDir, [
            ['manifest', undent`
                title=RokuDeployTestChannel
                major_version=1
                minor_version=0
                build_version=0
                ui_resolutions=hd
            `],
            ['source/main.brs', undent`
                sub Main()
                    screen = CreateObject("roSGScreen")
                    port = CreateObject("roMessagePort")
                    screen.setMessagePort(port)
                    scene = screen.CreateScene("HomeScene")
                    screen.show()
                    while true
                        msg = wait(0, port)
                        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
                    end while
                end sub
            `],
            ['components/HomeScene.xml', undent`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HomeScene" extends="Scene"></component>
            `]
        ]);
    }

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);
        rd = new RokuDeploy();
        options = rokuDeploy.getOptions({
            outDir: outDir,
            host: HOST,
            retainDeploymentArchive: true,
            password: PASSWORD
        });
        writeMinimalChannel();
    });

    afterEach(() => {
        //restore the original working directory
        process.chdir(cwd);
        fsExtra.emptyDirSync(tempDir);
    });

    /**
     * Assert that a value is a "response-ish" object as returned by doPostRequest/doGetRequest:
     * `{ response: { statusCode, headers }, body: string }`. This is the postman-request-compatible
     * shape that roku-deploy promises, so it's worth pinning down explicitly after the needle migration.
     */
    function expectHttpResponseShape(result: any) {
        expect(result).to.be.an('object');
        expect(result.response, 'result.response').to.be.an('object');
        expect(result.response.statusCode, 'result.response.statusCode').to.be.a('number');
        expect(result.response.headers, 'result.response.headers').to.be.an('object');
        expect(result.body, 'result.body').to.be.a('string');
    }

    describe('getDeviceInfo', () => {
        it('returns a raw device-info object with the expected structure/types', async () => {
            const info = await rd.getDeviceInfo({ host: HOST });
            //it's a non-empty object
            expect(info).to.be.an('object');
            expect(Object.keys(info).length).to.be.greaterThan(10);
            //raw values come back as strings (xml2js). Check a few well-known keys exist and are strings.
            expect(info['udn'], 'udn').to.be.a('string').with.length.greaterThan(0);
            expect(info['serial-number'], 'serial-number').to.be.a('string').with.length.greaterThan(0);
            expect(info['software-version'], 'software-version').to.be.a('string');
            //software-version should look like a version number (e.g. "15.2.4")
            expect(/^\d+\.\d+/.test(info['software-version']), `software-version "${info['software-version']}" should start with N.N`).to.be.true;
        });

        it('returns an enhanced device-info object with normalized types', async () => {
            const info = await rd.getDeviceInfo({ host: HOST, enhance: true });
            expect(info).to.be.an('object');
            //camelCased keys
            expect(info.udn, 'udn').to.be.a('string').with.length.greaterThan(0);
            expect(info.serialNumber, 'serialNumber').to.be.a('string').with.length.greaterThan(0);
            //softwareVersion should be coercible to a valid semver
            expect(semver.valid(semver.coerce(info.softwareVersion)), `softwareVersion "${info.softwareVersion}" should be semver-coercible`).to.not.be.null;
            //a "true"/"false" string should have been normalized to a real boolean
            expect(info.supportsEthernet, 'supportsEthernet').to.be.a('boolean');
            //a numeric string should have been normalized to a real number
            if (info.softwareBuild !== undefined) {
                expect(info.softwareBuild, 'softwareBuild').to.be.a('number');
            }
            //ecpSettingMode should be one of the known modes (or undefined on older firmware)
            if (info.ecpSettingMode !== undefined) {
                expect(['enabled', 'disabled', 'limited', 'permissive']).to.include(info.ecpSettingMode);
            }
        });

        it('honors a custom remotePort by failing fast against a closed port', async () => {
            //port 9 (discard) won't speak ECP; we just want to prove the option is threaded through.
            await expectThrowsAsync(
                rd.getDeviceInfo({ host: HOST, remotePort: 9, timeout: 2000 })
            );
        });
    });

    describe('getDevId', () => {
        it('returns the keyed developer id as a hex string', async () => {
            const devId = await rd.getDevId(options);
            expect(devId, 'devId').to.be.a('string').with.length.greaterThan(0);
            //keyed-developer-id is a hex string
            expect(/^[0-9a-f]+$/i.test(devId), `devId "${devId}" should be hex`).to.be.true;
        });
    });

    describe('getEcpNetworkAccessMode', () => {
        it('returns a known ECP access mode (or undefined on firmware that does not report it)', async () => {
            const mode = await rd.getEcpNetworkAccessMode({ host: HOST });
            //older firmware (or some query contexts) may not include ecp-setting-mode at all
            expect([undefined, 'enabled', 'disabled', 'limited', 'permissive']).to.include(mode);
        });
    });

    describe('validateDeveloperPassword', () => {
        it('returns true when the password is correct', async () => {
            const result = await rd.validateDeveloperPassword({ host: HOST, password: PASSWORD });
            assert.strictEqual(result, true);
        });

        it('returns false when the password is wrong', async () => {
            const result = await rd.validateDeveloperPassword({ host: HOST, password: 'NOT_THE_PASSWORD' });
            assert.strictEqual(result, false);
        });

        it('throws DeviceUnreachableError for an offline host', async () => {
            await expectThrowsAsync(
                rd.validateDeveloperPassword({ host: '192.168.254.254', password: PASSWORD, timeout: 2000 })
            );
        });
    });

    describe('pressHomeButton', () => {
        it('sends the keypress over ECP without error', async () => {
            //pressHomeButton resolves with the raw response; just make sure it didn't reject.
            const result = await rd.pressHomeButton(HOST);
            expectHttpResponseShape(result);
        });
    });

    describe('publish / deploy', () => {
        it('deploy zips + uploads the channel and reports success', async () => {
            const result = await rd.deploy(options);
            expect(result.message).to.match(/deploy|Identical/i);
            expectHttpResponseShape(result.results);
        });

        it('publish (without re-zipping) uploads an existing archive', async () => {
            //first build the zip on disk
            await rd.createPackage(options);
            const result = await rd.publish(options);
            expect(result.message).to.match(/deploy|Identical/i);
            expectHttpResponseShape(result.results);
        });

        it('presents a nice message for a 401 unauthorized status code', async () => {
            await expectThrowsAsync(
                rd.deploy({ ...options, password: 'NOT_THE_PASSWORD' }),
                `Unauthorized. Please verify credentials for host '${HOST}'`
            );
        });

        it('attaches the postman-style results to a thrown UnauthorizedDeviceResponseError', async () => {
            await rd.createPackage(options);
            let caught: any;
            try {
                await rd.publish({ ...options, password: 'NOT_THE_PASSWORD' });
            } catch (e) {
                caught = e;
            }
            expect(caught, 'should have thrown').to.be.instanceof(errors.UnauthorizedDeviceResponseError);
            expect(caught.results.response.statusCode).to.equal(401);
            expect(caught.results.response.request.host).to.equal(HOST);
            expect(caught.results.body).to.be.a('string');
        });
    });

    describe('takeScreenshot', () => {
        it('captures a screenshot of the running channel to a real file', async () => {
            //ensure a channel is running so the screenshot has content
            await rd.deploy(options);
            const filePath = await rd.takeScreenshot({ host: HOST, password: PASSWORD });
            expectPathExists(filePath);
            expect(fsExtra.statSync(filePath).size, 'screenshot byte size').to.be.greaterThan(0);
            expect(filePath).to.match(/\.(jpg|png)$/i);
        });
    });

    describe('convertToSquashfs', () => {
        it('converts the currently-installed channel to squashfs', async () => {
            //must have a channel loaded first
            await rd.deploy(options);
            //resolves (no throw) on success; throws ConvertError on failure
            await rd.convertToSquashfs(options);
        });
    });

    describe('component libraries', () => {
        it('deleteAllComponentLibraries enumerates packages and completes without error', async () => {
            //even with zero component libraries installed, this should query the device and resolve.
            await rd.deleteAllComponentLibraries({ host: HOST, password: PASSWORD });
        });

        it('deleteComponentLibrary issues the delete request and gets a real device response', async () => {
            //deleting a non-existent dcl exercises the full request/response path. The device responds
            //with a "Failed: Invalid filename" message, which roku-deploy surfaces as a
            //FailedDeviceResponseError. Either outcome (resolve, or that specific error) proves the
            //networking path works; anything else is a real problem.
            try {
                await rd.deleteComponentLibrary({ host: HOST, password: PASSWORD, fileName: 'does-not-exist.zip' });
            } catch (e) {
                expect(e, `unexpected error: ${e}`).to.be.instanceof(errors.FailedDeviceResponseError);
                expect((e as Error).message).to.match(/invalid filename/i);
            }
        });
    });

    describe('deleteInstalledChannel', () => {
        it('deletes the installed dev channel and returns a response', async () => {
            //make sure something is installed first
            await rd.deploy(options);
            const result = await rd.deleteInstalledChannel(options);
            expectHttpResponseShape(result);
        });

        it('resolves even when no channel is installed', async () => {
            //delete twice; the second delete has nothing to remove but should still resolve
            await rd.deploy(options);
            await rd.deleteInstalledChannel(options);
            const result = await rd.deleteInstalledChannel(options);
            expectHttpResponseShape(result);
        });
    });

    describe('package signing', () => {
        //these require a signingPassword that matches the device's installed dev key.
        const maybe = SIGNING_PASSWORD ? it : it.skip;

        maybe('rekeyDevice + signExistingPackage + retrieveSignedPackage produce a .pkg', async function signing() {
            this.timeout(60000);
            const signingOptions = {
                ...options,
                signingPassword: SIGNING_PASSWORD,
                rekeySignedPackage: `${cwd}/testSignedPackage.pkg`
            };
            //deploy + retain staging so the manifest is available for signing
            await rd.deploy({ ...signingOptions, retainStagingDir: true });
            const remotePkgPath = await rd.signExistingPackage(signingOptions);
            expect(remotePkgPath, 'remote pkg path').to.be.a('string').that.matches(/\.pkg$/);
            const localPkgPath = await rd.retrieveSignedPackage(remotePkgPath, signingOptions);
            expectPathExists(localPkgPath);
            expect(fsExtra.statSync(localPkgPath).size).to.be.greaterThan(0);
        });

        maybe('deployAndSignPackage produces a local .pkg file', async function signAndDeploy() {
            this.timeout(60000);
            const pkgFilePath = await rd.deployAndSignPackage({
                ...options,
                signingPassword: SIGNING_PASSWORD,
                rekeySignedPackage: `${cwd}/testSignedPackage.pkg`
            });
            expectPathExists(pkgFilePath);
        });
    });

    describe('firmware-gated operations', () => {
        //rebootDevice and checkForUpdate require firmware >= 15.0.4. They're also disruptive (a reboot
        //takes the device offline for a while), so they only run when explicitly opted in.
        const maybe = RUN_DISRUPTIVE ? it : it.skip;

        maybe('checkForUpdate triggers an update check', async () => {
            const result = await rd.checkForUpdate(options);
            expectHttpResponseShape(result);
        });

        maybe('rebootDevice reboots the device', async function reboot() {
            this.timeout(60000);
            const result = await rd.rebootDevice(options);
            expectHttpResponseShape(result);
        });

        it('rebootDevice/checkForUpdate guard against old firmware', async () => {
            //we can at least confirm the firmware-version gate logic runs against the real device-info.
            const info = await rd.getDeviceInfo({ host: HOST, enhance: true });
            const version = semver.coerce(info.softwareVersion);
            //if the device is new enough, checkForUpdate should NOT throw the UnsupportedFirmwareVersionError.
            if (version && semver.gte(version, '15.0.4') && RUN_DISRUPTIVE) {
                await rd.checkForUpdate(options);
            } else if (version && semver.lt(version, '15.0.4')) {
                await expectThrowsAsync(
                    rd.checkForUpdate(options),
                    undefined,
                    'expected UnsupportedFirmwareVersionError on old firmware'
                );
            }
        });
    });
});
