import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fsExtra from 'fs-extra';
import * as net from 'net';
import * as http from 'http';
import * as path from 'path';
import * as semver from 'semver';
import * as dotenv from 'dotenv';
import * as rokuDeploy from './index';
import * as errors from './Errors';
import { expect } from 'chai';
import { cwd, expectPathExists, expectThrowsAsync, outDir, rootDir, stagingDir, tempDir, writeFiles } from './testUtils.spec';
import undent from 'undent';
import { standardizePath as s } from './util';

//load device connection info from a .env file at the repo root (if present), then fall back to any
//pre-existing environment variables. This is how CI/CD (and local dev) point the device suite at a
//real Roku without hardcoding host/password into the repo. See .env.example.
dotenv.config({
    path: path.resolve(__dirname, '../.env'),
    override: true,
    quiet: true
});

const HOST = process.env.ROKU_HOST;
const PASSWORD = process.env.ROKU_PASSWORD;

//socket teardown callbacks, drained in afterEach so the suite doesn't hang open
const cleanups: Array<() => void> = [];

//explicit short per-request timeout for the reboot-prone tests. The roku-deploy default is 150s; a
//short timeout guarantees any request against an unresponsive/rebooting device aborts (and closes its
//socket) quickly instead of hanging open and keeping the mocha process alive after the run.
const REQUEST_TIMEOUT = 15_000;

//these tests are run against an actual roku device and need to be run on our self-hosted runners.
describe('device', function device() {
    //sane suite-wide default for the many quick ECP/HTTP calls (device-info, dev-id, press-home,
    //etc.). Tests that legitimately take longer set their own `this.timeout(...)` inline, sized at
    //roughly double their observed runtime. A tight default here means a broken device test fails
    //fast instead of hanging the full old 120s.
    this.timeout(10_000);

    let options: rokuDeploy.RokuDeployOptions;

    before(() => {
        //fail fast with a clear message rather than letting every test time out against an empty host
        if (!HOST || !PASSWORD) {
            throw new Error(
                `Missing Roku device connection info. Set ROKU_HOST and ROKU_PASSWORD in "${path.resolve(__dirname, '../.env')}" ` +
                `(see .env.example) or as environment variables before running "npm run test:device".`
            );
        }
    });

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);
        options = rokuDeploy.getOptions({
            outDir: outDir,
            host: HOST,
            retainDeploymentArchive: true,
            password: PASSWORD,
            devId: 'c6fdc2019903ac3332f624b0b2c2fe2c733c3e74',
            rekeySignedPackage: `${cwd}/testSignedPackage.pkg`,
            signingPassword: 'drRCEVWP/++K5TYnTtuAfQ=='
        });

        writeFiles(rootDir, [
            ['manifest', undent`
                title=RokuDeployTestChannel
                major_version=1
                minor_version=0
                build_version=0
                splash_screen_hd=pkg:/images/splash_hd.jpg
                ui_resolutions=hd
                bs_const=IS_DEV_BUILD=false
                splash_color=#000000
            `],
            ['source/main.brs', undent`
                Sub Main()
                    screen = CreateObject("roSGScreen")
                    m.scene = screen.CreateScene("HomeScene")
                    port = CreateObject("roMessagePort")
                    screen.SetMessagePort(port)
                    screen.Show()

                    while(true)
                        msg = wait(0, port)
                    end while

                    if screen <> invalid then
                        screen.Close()
                        screen = invalid
                    end if
                End Sub
            `],
            ['components/HomeScene.xml', undent`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HomeScene" extends="Scene"></component>
            `]
        ]);
    });

    afterEach(() => {
        //tear down any sockets/connections opened during the test so the suite doesn't hang open
        while (cleanups.length > 0) {
            try {
                cleanups.pop()();
            } catch { }
        }
        //restore the original working directory
        process.chdir(cwd);
        fsExtra.emptyDirSync(tempDir);
    });

    function countByType(packages: Array<{ appType: string }>) {
        return {
            channels: packages.filter(x => x.appType === 'channel').length,
            complibs: packages.filter(x => x.appType === 'dcl').length
        };
    }

    /**
     * Return the archiveFileNames of only the installed component libraries (DCLs)
     */
    async function getInstalledComponentLibraryFileNames() {
        const packages = await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password });
        return packages.filter(x => x.appType === 'dcl').map(x => x.archiveFileName);
    }

    /**
     * Build and sideload a channel onto the device
     */
    async function installChannel() {
        await rokuDeploy.rokuDeploy.deploy({
            ...options,
            appType: 'channel',
            outFile: 'channel'
        });
    }

    //A bare complib zip lands around ~386 bytes, below the device's 512-byte minimum installable size,
    //so the install fails as "Invalid or corrupt zip archive". We pad the component XML with this block of
    //high-entropy (incompressible) text so the packaged zip clears the boundary. Hardcoded on purpose:
    //a repeated/low-entropy string would compress away and give us no size gain.
    const COMPLIB_PADDING = 'k7Jq2fVr9WpN4xZa1BcM6sTgL0oYhDeUuIiRt8vXnQwEyKlOpAzSdFgHjClZ3mBnV5cX8rT2wQ9eR7yU1iO0pAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNmk7Jq2fVr9WpN4xZa1BcM6sTgL0oYhDeUuIiRt8vXnQwEyKlOpAzSdFgHjClZ3mBnV5cX8rT2wQ9eR7yU1iO0pAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNm7pL3xQ9zW2eR8tY5uI1oP4aS6dF0gH7jK2lZ8xC3vB9nM4qW1eR6tY7uI0oP5aS8dF2gH9jK4lZ1xC6vB3nM';

    /**
     * Build and sideload a component library onto the device. Each complib gets a unique
     * name so they end up as distinct packages on the device.
     */
    async function installComponentLibrary(name: string) {
        //a component library needs its own root dir with a manifest that declares the lib it provides
        const libRootDir = `${tempDir}/${name}`;
        writeFiles(libRootDir, [
            ['manifest', undent`
                title=${name}
                sg_component_libs_provided=${name}
            `],
            [`components/${name}.xml`, undent`
                <component name="${name}">
                    <!-- ${COMPLIB_PADDING} -->
                </component>
            `]
        ]);

        await rokuDeploy.rokuDeploy.createPackage({
            ...options,
            rootDir: libRootDir,
            stagingDir: `${stagingDir}-${name}`,
            outDir: outDir,
            outFile: name
        });
        await rokuDeploy.rokuDeploy.publish({
            ...options,
            appType: 'dcl',
            outDir: outDir,
            outFile: name
        });
    }

    describe('deploy', () => {
        it('works', async function deployWorks() {
            this.timeout(12_000);
            options.retainDeploymentArchive = true;
            let response = await rokuDeploy.deploy(options);
            assert.equal(response.message, 'Successful deploy');
        });

        it('Presents nice message for 401 unauthorized status code', async function unauthorized() {
            this.timeout(10_000);
            options.password = 'NOT_THE_PASSWORD';
            await expectThrowsAsync(
                rokuDeploy.deploy(options),
                `Unauthorized. Please verify credentials for host '${options.host}'`
            );
        });
    });

    describe('publish', () => {
        it('works', async function publishWorks() {
            this.timeout(6_000);
            await rokuDeploy.createPackage(options);
            let response = await rokuDeploy.publish(options);
            assert.equal(response.message, 'Successful deploy');
        });
    });

    describe('deployAndSignPackage', () => {
        it('works', async function deployAndSignPackageWorks() {
            this.timeout(12_000);
            await rokuDeploy.deleteInstalledChannel(options);
            await rokuDeploy.rekeyDevice(options);
            expectPathExists(
                await rokuDeploy.deployAndSignPackage(options)
            );
        });
    });

    describe('validateDeveloperPassword', () => {
        it('returns true when the password is correct', async () => {
            const result = await rokuDeploy.rokuDeploy.validateDeveloperPassword({
                host: options.host,
                password: options.password
            });
            assert.strictEqual(result, true);
        });

        it('returns false when the password is wrong', async () => {
            const result = await rokuDeploy.rokuDeploy.validateDeveloperPassword({
                host: options.host,
                password: 'NOT_THE_PASSWORD'
            });
            assert.strictEqual(result, false);
        });

        it('throws DeviceUnreachableError for an offline host', async () => {
            await expectThrowsAsync(async () => {
                await rokuDeploy.rokuDeploy.validateDeveloperPassword({
                    host: '192.168.254.254',
                    password: 'aaaa',
                    timeout: 2000
                });
            });
        });
    });

    describe('getDeviceInfo', () => {
        it('works', async () => {
            const info = await rokuDeploy.rokuDeploy.getDeviceInfo({ host: options.host });
            assert.ok(info);
            assert.ok(info['software-version']);
        });

        it('normalizes types when enhanced', async () => {
            const info = await rokuDeploy.rokuDeploy.getDeviceInfo({ host: options.host, enhance: true });
            assert.ok(info.softwareVersion);
            assert.strictEqual(typeof info.supportsEthernet, 'boolean');
        });
    });

    describe('getDevId', () => {
        it('works', async () => {
            const devId = await rokuDeploy.rokuDeploy.getDevId(options);
            assert.ok(devId);
        });
    });

    describe('getEcpNetworkAccessMode', () => {
        it('works', async () => {
            const mode = await rokuDeploy.rokuDeploy.getEcpNetworkAccessMode({ host: options.host });
            assert.ok([undefined, 'enabled', 'disabled', 'limited', 'permissive'].includes(mode));
        });
    });

    describe('pressHomeButton', () => {
        it('works', async () => {
            await rokuDeploy.rokuDeploy.pressHomeButton(options.host);
        });
    });

    describe('takeScreenshot', () => {
        it('works', async function takeScreenshot() {
            //this test waits on the debug console for a marker (up to 45s internally), so its ceiling
            //is driven by that wait rather than the observed happy-path runtime.
            this.timeout(60_000);

            //A screenshot only works when a side-loaded channel is actively running. Rather than
            //guessing that `deploy` left the app running, we make main.brs print a unique, timestamped
            //marker once its scene is shown, connect to the debug console (telnet port 8085), and wait
            //until we observe THAT marker. Then we cross-check via ECP that the dev channel really is
            //foregrounded before asking for the screenshot.
            const marker = `ROKU_DEPLOY_SCREENSHOT_TEST ${new Date().toISOString()} ${Math.random().toString(36).slice(2)}`;
            writeFiles(rootDir, [
                ['source/main.brs', undent`
                    Sub Main()
                        screen = CreateObject("roSGScreen")
                        m.scene = screen.CreateScene("HomeScene")
                        port = CreateObject("roMessagePort")
                        screen.SetMessagePort(port)
                        screen.Show()
                        print "${marker}"

                        while(true)
                            msg = wait(0, port)
                        end while
                    End Sub
                `]
            ]);

            //start listening on the debug console BEFORE deploying so we don't miss the marker.
            //(the socket's teardown is registered in `cleanups` and drained by afterEach)
            const sawMarker = waitForConsoleOutput(options.host, marker, 45000);

            await rokuDeploy.deploy(options);

            //the marker proves our freshly-deployed channel actually reached the "scene shown" point this run
            await sawMarker;

            //belt-and-suspenders: confirm the dev channel is the active app via ECP
            const activeApp = await getActiveApp(options.host);
            assert.ok(/dev/i.test(activeApp), `expected the dev channel to be the active app, got: ${activeApp}`);

            const filePath = await rokuDeploy.rokuDeploy.takeScreenshot({ host: options.host, password: options.password });
            expectPathExists(filePath);
        });
    });

    describe('convertToSquashfs', () => {
        it('works', async function convertToSquashfsWorks() {
            this.timeout(15_000);
            await rokuDeploy.deploy(options);
            await rokuDeploy.rokuDeploy.convertToSquashfs(options);
        });
    });

    describe('deleteAllComponentLibraries', () => {
        it('works', async () => {
            await rokuDeploy.rokuDeploy.deleteAllComponentLibraries({ host: options.host, password: options.password });
        });
    });

    describe('deleteInstalledChannel', () => {
        it('works', async () => {
            await rokuDeploy.deploy(options);
            await rokuDeploy.deleteInstalledChannel(options);
        });
    });

    describe('deleteAllSideloadedPlugins', function deleteAllTests() {
        //these tests do several device round-trips (install + verify + delete). ~2x the slowest
        //observed case in this block (the multi-library delete, ~10s).
        this.timeout(20_000);

        it('deletes a single channel', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            await installChannel();

            //the channel should now be installed
            expect(countByType(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password }))).to.eql({
                channels: 1,
                complibs: 0
            });

            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password })).to.eql([]);
        });

        it('deletes a single component library', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            await installComponentLibrary('a');

            //the complib should now be installed
            expect(countByType(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password }))).to.eql({
                channels: 0,
                complibs: 1
            });

            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password })).to.eql([]);
        });

        it('deletes a channel and a component library together', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            await installChannel();
            await installComponentLibrary('complib1');

            //both should now be installed
            expect(countByType(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password }))).to.eql({
                channels: 1,
                complibs: 1
            });

            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password })).to.eql([]);
        });

        it('deletes a channel and two component libraries together', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            await installChannel();
            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');

            //all three should now be installed
            expect(countByType(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password }))).to.eql({
                channels: 1,
                complibs: 2
            });

            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password })).to.eql([]);
        });
    });

    describe('install size boundary', function installSizeBoundary() {
        //Roku firmware rejects sideloaded zips below a hard minimum size (512 bytes on firmware 15.x, for
        //both channels and complibs) with "Unzip failed. Invalid or corrupt zip archive." Each test builds
        //a zip of exactly (BOUNDARY - 1) and exactly BOUNDARY bytes and asserts the former fails, the latter installs.
        //~2x the slowest observed case in this block (~5.6s).
        this.timeout(12_000);
        const BOUNDARY = rokuDeploy.RokuDeploy.MINIMUM_INSTALLABLE_ZIP_SIZE;

        //`n` incompressible chars, so 1 char of comment padding == ~1 zip byte and we can converge on an
        //exact zip size (a repeated char would compress away and give us no size control).
        function noise(n: number): string {
            return crypto.randomBytes(n).toString('base64').slice(0, n);
        }

        //build a zip in `dir` whose size is EXACTLY `target` bytes.
        //`dir` doubles as rootDir and outDir; `files` is explicit so the glob never re-includes app.zip.
        async function buildExactZip(dir: string, files: string[], writeProject: (pad: string) => void, target: number): Promise<void> {
            const build = async (pad: string) => {
                writeProject(pad);
                await rokuDeploy.rokuDeploy.createPackage({ ...options, rootDir: dir, stagingDir: s`${dir}/staging`, outDir: dir, outFile: 'app', files: files });
                return fsExtra.statSync(s`${dir}/app.zip`).size;
            };
            //converge the padding length until the zip is exactly `target` bytes (1 pad char ~ 1 zip byte)
            let padLen = target;
            let size = await build(noise(padLen));
            for (let i = 0; i < 40 && size !== target; i++) {
                padLen = Math.max(0, padLen + (target - size));
                size = await build(noise(padLen));
            }
            if (size !== target) {
                throw new Error(`could not construct an exact ${target}-byte zip (closest ${size})`);
            }
        }

        //build a zip of exactly `target` bytes and publish it; return whether it installed.
        async function installsAtSize(dir: string, files: string[], appType: 'channel' | 'dcl', writeProject: (pad: string) => void, target: number): Promise<boolean> {
            await buildExactZip(dir, files, writeProject, target);
            try {
                await rokuDeploy.rokuDeploy.publish({ ...options, outDir: dir, outFile: 'app', appType: appType, failOnCompileError: true });
                return true;
            } catch {
                return false;
            }
        }

        async function assertBoundary(label: string, dir: string, files: string[], appType: 'channel' | 'dcl', writeProject: (pad: string) => void) {
            process.chdir(cwd); //beforeEach parks us inside the shared .tmp
            fsExtra.removeSync(dir);
            fsExtra.ensureDirSync(dir);
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            const below = await installsAtSize(dir, files, appType, writeProject, BOUNDARY - 1);
            const at = await installsAtSize(dir, files, appType, writeProject, BOUNDARY);
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            console.log(`[${label}] ${BOUNDARY - 1}=>${below ? 'OK' : 'FAIL'} ${BOUNDARY}=>${at ? 'OK' : 'FAIL'}`);
            expect(below, `expected a ${BOUNDARY - 1}-byte ${label} zip to be REJECTED`).to.equal(false);
            expect(at, `expected a ${BOUNDARY}-byte ${label} zip to INSTALL`).to.equal(true);
        }

        it(`channel: rejects zips below ${BOUNDARY} bytes, accepts at/above`, async () => {
            await assertBoundary('channel', s`${tempDir}/ziptest-channel`, ['manifest', 'source/**/*'], 'channel', (pad) => {
                fsExtra.outputFileSync(s`${tempDir}/ziptest-channel/manifest`, 'title=a');
                fsExtra.outputFileSync(s`${tempDir}/ziptest-channel/source/main.brs`, `sub Main()\n'${pad}\nend sub`);
            });
        });

        it(`complib: rejects zips below ${BOUNDARY} bytes, accepts at/above`, async () => {
            await assertBoundary('complib', s`${tempDir}/ziptest-complib`, ['manifest', 'components/**/*'], 'dcl', (pad) => {
                fsExtra.outputFileSync(s`${tempDir}/ziptest-complib/manifest`, 'sg_component_libs_provided=a');
                fsExtra.outputFileSync(s`${tempDir}/ziptest-complib/components/a.xml`, `<component name="a"><!--${pad}--></component>`);
            });
        });

        it('publish() of an undersized zip throws an error explaining the size limit', async () => {
            process.chdir(cwd); //beforeEach parks us inside the shared .tmp
            const dir = s`${tempDir}/ziptest-undersized`;
            fsExtra.removeSync(dir);
            fsExtra.ensureDirSync(dir);
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            //a zip below the minimum installable size; the device rejects it as a corrupt zip
            const size = BOUNDARY - 1;
            await buildExactZip(dir, ['manifest', 'source/**/*'], (pad) => {
                fsExtra.outputFileSync(s`${dir}/manifest`, 'title=a');
                fsExtra.outputFileSync(s`${dir}/source/main.brs`, `sub Main()\n'${pad}\nend sub`);
            }, size);

            let thrown: Error;
            try {
                await rokuDeploy.rokuDeploy.publish({ ...options, outDir: dir, outFile: 'app', appType: 'channel', failOnCompileError: true });
            } catch (e) {
                thrown = e as Error;
            }

            expect(thrown, 'expected publish() to throw for an undersized zip').to.be.ok;
            //the device's corrupt-zip failure, plus our appended size hint
            expect(thrown.message).to.contain('Invalid or corrupt zip archive');
            expect(thrown.message).to.contain(`The supplied zip is ${size} bytes`);
            expect(thrown.message).to.contain(`zips smaller than ${BOUNDARY} bytes`);
        });
    });

    describe('deleteComponentLibrary', function deleteComponentLibraryTests() {
        //these tests install several complibs and then delete them one at a time. ~2x the slowest
        //observed case in this block (~13s).
        this.timeout(30_000);

        it('deletes several component libraries one by one', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');
            await installComponentLibrary('complib3');

            //all three complibs should now be installed
            const fileNames = await getInstalledComponentLibraryFileNames();
            expect(fileNames).to.have.lengthOf(3);

            //delete them one at a time, verifying after each delete that the targeted complib is gone
            //and that the count drops by exactly one (the others are left intact)
            let expectedRemaining = fileNames.length;
            for (const target of fileNames) {
                await rokuDeploy.rokuDeploy.deleteComponentLibrary({
                    host: options.host,
                    password: options.password,
                    fileName: target
                });
                expectedRemaining--;

                const afterDelete = await getInstalledComponentLibraryFileNames();
                //the deleted complib should no longer be present...
                expect(afterDelete).to.not.include(target);
                //...and exactly one fewer complib should remain
                expect(afterDelete).to.have.lengthOf(expectedRemaining);
            }

            //everything should be gone now
            expect(await getInstalledComponentLibraryFileNames()).to.eql([]);
        });

        it('leaves other component libraries intact when deleting one', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');

            const fileNames = await getInstalledComponentLibraryFileNames();
            expect(fileNames).to.have.lengthOf(2);

            //delete just the first complib
            const [toDelete, toKeep] = fileNames;
            await rokuDeploy.rokuDeploy.deleteComponentLibrary({
                host: options.host,
                password: options.password,
                fileName: toDelete
            });

            //only the second complib should remain
            expect(await getInstalledComponentLibraryFileNames()).to.eql([toKeep]);

            //clean up
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);
        });

        it('deletes a component library without affecting an installed channel', async () => {
            //start clean
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);

            //install a channel alongside the complibs
            await rokuDeploy.rokuDeploy.deploy({
                ...options,
                appType: 'channel',
                outFile: 'channel'
            });
            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');

            expect(await getInstalledComponentLibraryFileNames()).to.have.lengthOf(2);

            //delete the complibs one by one
            for (const fileName of await getInstalledComponentLibraryFileNames()) {
                await rokuDeploy.rokuDeploy.deleteComponentLibrary({
                    host: options.host,
                    password: options.password,
                    fileName: fileName
                });
            }

            //all complibs gone, but the channel should still be installed
            const packages = await rokuDeploy.rokuDeploy.listSideloadedPlugins({ host: options.host, password: options.password });
            expect(packages.filter(x => x.appType === 'dcl')).to.eql([]);
            expect(packages.filter(x => x.appType === 'channel')).to.have.lengthOf(1);

            //clean up
            await rokuDeploy.rokuDeploy.deleteAllSideloadedPlugins(options);
        });
    });

    //these tests are slow (and can reboot the device), so they run last so as many other tests as
    //possible finish and report before we hit them.
    describe('rebootDevice', () => {
        it('works', async function rebootDevice() {
            //a reboot takes the device offline for a while; the ceiling is driven by
            //waitForDeviceOnline (up to ~120s) plus the reboot POST, not the observed happy-path time.
            this.timeout(150_000);
            //use a short per-request timeout so the reboot POST can't hang open past the device going
            //down; without this it would inherit the 150s default and could orphan a socket if mocha's
            //test-timeout fired first.
            await rokuDeploy.rokuDeploy.rebootDevice({ ...options, timeout: REQUEST_TIMEOUT });
            //wait until the device is reachable again so the next test doesn't run mid-reboot
            await waitForDeviceOnline(options.host);
        });
    });

    describe('checkForUpdate', () => {
        //checkForUpdate requires firmware >= this version; below it, it throws UnsupportedFirmwareVersionError
        const MIN_FIRMWARE = '15.0.4';

        it('works', async function checkForUpdate() {
            //triggers a real update check against Roku's servers, which can be slow and can sometimes
            //trigger a reboot; the ceiling is the update check plus a possible reboot + waitForDeviceOnline
            //(up to ~120s), so keep it generous rather than sizing to the observed happy-path time.
            this.timeout(180_000);

            //Every device call below uses an explicit short `timeout` so no underlying needle request can
            //hang open indefinitely (the default is 150s). This guarantees each request either resolves or
            //rejects and closes its socket on its own, rather than being orphaned if mocha's test-timeout
            //were to fire mid-request.
            const reqOptions = { ...options, timeout: REQUEST_TIMEOUT };

            //we don't know which device the suite runs against, so ask it what firmware it has and
            //decide up-front whether checkForUpdate should succeed or be rejected by the version gate.
            const softwareVersion = (await rokuDeploy.rokuDeploy.getDeviceInfo({ host: options.host, timeout: REQUEST_TIMEOUT }))['software-version'];
            const supported = !!softwareVersion && semver.gte(semver.coerce(softwareVersion), MIN_FIRMWARE);

            if (supported) {
                console.log(`[checkForUpdate] device firmware ${softwareVersion} >= ${MIN_FIRMWARE}; expecting success`);
                const result = await rokuDeploy.rokuDeploy.checkForUpdate(reqOptions);
                assert.ok(result, 'expected a response from checkForUpdate');
                //checkForUpdate can trigger a reboot; make sure the device is back before the next test
                await waitForDeviceOnline(options.host);
            } else {
                console.log(`[checkForUpdate] device firmware ${softwareVersion} < ${MIN_FIRMWARE}; expecting UnsupportedFirmwareVersionError`);
                let thrown: Error;
                try {
                    await rokuDeploy.rokuDeploy.checkForUpdate(reqOptions);
                } catch (e) {
                    thrown = e as Error;
                }
                assert.ok(thrown, 'expected checkForUpdate to throw on unsupported firmware');
                assert.ok(
                    thrown instanceof errors.UnsupportedFirmwareVersionError,
                    `expected UnsupportedFirmwareVersionError, got ${thrown?.constructor?.name}: ${thrown?.message}`
                );
            }
        });
    });
});

/**
 * Connect to the Roku debug console (telnet, port 8085) and resolve once a line containing `marker`
 * is observed. Rejects if the marker isn't seen within `timeout` ms. Used to prove that a
 * freshly-deployed channel actually reached a known point in its own code during THIS test run.
 *
 * The telnet socket's teardown is registered in `cleanups` so the `afterEach` hook always tears it
 * down (even on the happy path), otherwise the open connection keeps the mocha process alive after
 * the suite finishes.
 */
function waitForConsoleOutput(host: string, marker: string, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const socket = net.connect(8085, host);
        //don't let this socket alone keep the event loop (and thus the process) alive
        socket.unref();
        let buffer = '';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out after ${timeout}ms waiting for marker "${marker}" on ${host}:8085`));
        }, timeout);
        //setTimeout also holds the loop open; let it be non-blocking too
        timer.unref();

        function cleanup() {
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
        }
        //ensure the socket is always torn down, even if the marker arrives and we resolve normally
        cleanups.push(cleanup);

        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes(marker)) {
                cleanup();
                resolve();
            }
        });
        socket.on('error', (err) => {
            cleanup();
            reject(err);
        });
    });
}

/**
 * Query ECP (port 8060) for the currently-active app and return its raw XML body. The dev channel
 * reports itself as `dev` in the `<app>` node, so callers can assert against that.
 */
function getActiveApp(host: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const req = http.get(`http://${host}:8060/query/active-app`, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk.toString();
            });
            res.on('end', () => resolve(body));
        });
        //register teardown so afterEach can kill a hung request; harmless once the request completes
        cleanups.push(() => req.destroy());
        req.on('error', reject);
        //never let a hung request keep the process open
        req.setTimeout(10000, () => {
            req.destroy(new Error(`Timed out querying active-app on ${host}:8060`));
        });
    });
}

/**
 * Wait for a device to be reachable again by polling its device-info over ECP until it responds.
 * Used after operations that reboot the device (rebootDevice, and sometimes checkForUpdate) so the
 * next test doesn't run against a device that's still rebooting.
 *
 * @param graceMs how long to wait before the first poll, giving the device time to actually go down
 *   after the reboot was issued (so we don't immediately see the still-alive pre-reboot device)
 */
async function waitForDeviceOnline(host: string, timeoutMs = 120_000, intervalMs = 3000, graceMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    //give the device a moment to actually start going down before we begin polling
    await sleep(graceMs);
    let lastError: Error;
    while (Date.now() < deadline) {
        try {
            await rokuDeploy.rokuDeploy.getDeviceInfo({ host: host, timeout: intervalMs });
            //a successful device-info query means ECP is up and the device is responsive again
            return;
        } catch (e) {
            lastError = e as Error;
            await sleep(intervalMs);
        }
    }
    throw new Error(`Device ${host} did not come back online within ${timeoutMs}ms. Last error: ${lastError?.message}`);
}

/**
 * A sleep whose timer is `unref()`'d and registered in `cleanups`, so a pending delay can never keep
 * the mocha process alive after the suite finishes (unlike a bare `setTimeout`).
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
        cleanups.push(() => {
            clearTimeout(timer);
            //resolve so any awaiter unblocks during teardown instead of hanging
            resolve();
        });
    });
}
