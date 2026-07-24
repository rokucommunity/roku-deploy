import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import * as dotenv from 'dotenv';
import * as rokuDeploy from './index';
import { RokuDeploy } from './RokuDeploy';
import * as errors from './Errors';
import { expect } from 'chai';
import { cwd, expectPathExists, expectThrowsAsync, outDir, rootDir, stagingDir, tempDir, writeFiles } from './testUtils.spec';
import undent from 'undent';
import { standardizePath as s } from './util';
import { RceManagementClient } from './RceManagementClient';
import { createTelnetSocket } from './TelnetSocket';
import type { DeviceConfig } from './DeviceConfig';

//load device connection info from a .env file at the repo root (if present), then fall back to any
//pre-existing environment variables. This is how CI/CD (and local dev) point this suite at a real
//Roku Cloud Emulator (RCE) device without hardcoding the token/device id/password into the repo. See
//.env.example.
dotenv.config({
    path: path.resolve(__dirname, '../.env'),
    override: true,
    quiet: true
});

const RCE_TOKEN = process.env.ROKU_RCE_TOKEN;
const RCE_DEVICE_ID = process.env.ROKU_RCE_DEVICE_ID;
const RCE_PASSWORD = process.env.ROKU_RCE_PASSWORD;

//whether the suite has enough connection info to run at all. Unlike device.spec.ts (which is excluded
//from `test`/`test:nocover`/`test:all` by its exact filename in package.json's `--exclude`), this file
//has no such exclusion, so it WOULD be picked up by those scripts' `src/**/*.spec.ts` glob. When the
//RCE env vars are absent, self-skip the whole describe block below so CI stays green instead of
//failing on the throw inside `before()`. When they ARE present, `before()` still fails fast on a
//partial/missing value as a second line of defense, mirroring device.spec.ts's structure.
const hasRceEnvConfig = !!(RCE_TOKEN && RCE_DEVICE_ID && RCE_PASSWORD);

//socket teardown callbacks, drained in afterEach so the suite doesn't hang open
const cleanups: Array<() => void> = [];

//module-level RokuDeploy instance for the standalone helper functions below the describe block
//(the suite's `rd` is scoped to the describe and not visible here)
const helperRd = new RokuDeploy();

//management-api client used by `before()` to confirm the target device is actually running before any
//test talks to it.
const managementClient = new RceManagementClient({ token: RCE_TOKEN });

//explicit short per-request timeout for the reboot-prone tests. The roku-deploy default is 150s; a
//short timeout guarantees any request against an unresponsive device aborts (and closes its socket)
//quickly instead of hanging open and keeping the mocha process alive after the run. Doubled from the
//LAN suite's 15s to account for cloud round-trip latency (roughly 0.5-2s per request, plus the
//instance url resolution that happens on a RokuDeploy instance's first request).
const REQUEST_TIMEOUT = 30_000;

//these tests are run against a real Roku Cloud Emulator (RCE) device and need to be run on our
//self-hosted runners, against a device instance that is already started (via the extension's Cloud
//Emulator panel or the management api). This suite never starts or stops the instance itself.
(hasRceEnvConfig ? describe : describe.skip)('rce-device', function rceDevice() {
    //sane suite-wide default for the many quick ECP2/HTTP calls (device-info, dev-id, press-home,
    //etc.). Tests that legitimately take longer set their own `this.timeout(...)` inline, sized at
    //roughly double their observed runtime. Doubled from the LAN suite's 10s default to account for
    //cloud round-trip latency and the per-test instance url resolution described above.
    this.timeout(20_000);

    //device/password are required by every v4 device method; the `before` hook guarantees they're set,
    //so narrow the type here (they're optional on the base RokuDeployOptions) to avoid
    //spreading an optional device/password into methods that require them.
    let options: rokuDeploy.RokuDeployOptions & { device: { id: string; rceToken: string }; password: string };
    //v4 has no top-level exported functions; every call goes through a RokuDeploy instance
    let rd: RokuDeploy;
    //v4 RokuDeployOptions no longer carries the rekey package path (old `rekeySignedPackage`); track it separately
    const rekeySignedPackage = `${cwd}/testSignedPackage.pkg`;
    //the host portion of the device's resolved instance url, captured in `before()` so the 401 test
    //below can assert against it without re-resolving it itself
    let resolvedInstanceHost: string;

    before(async () => {
        //fail fast with a clear message rather than letting every test time out against missing connection info
        if (!RCE_TOKEN || !RCE_DEVICE_ID || !RCE_PASSWORD) {
            throw new Error(
                `Missing Roku Cloud Emulator connection info. Set ROKU_RCE_TOKEN, ROKU_RCE_DEVICE_ID, and ` +
                `ROKU_RCE_PASSWORD in "${path.resolve(__dirname, '../.env')}" (see .env.example) or as environment ` +
                `variables before running "npx mocha src/rce-device.spec.ts".`
            );
        }

        //resolve the device through the management api and fail fast if it isn't already running. This
        //suite talks directly to a running instance and never starts one on the caller's behalf.
        const device = await managementClient.getDevice(RCE_DEVICE_ID);
        if (device.status !== 'running') {
            throw new Error(
                `RCE device ${RCE_DEVICE_ID} is not running (status '${device.status}'). Start it from the ` +
                `extension's Cloud Emulator panel, or via the management api, before running ` +
                `"npx mocha src/rce-device.spec.ts".`
            );
        }
        resolvedInstanceHost = new URL(device.running_device.instance_api_url).host;
    });

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);
        rd = new RokuDeploy();
        options = {
            device: { id: RCE_DEVICE_ID, rceToken: RCE_TOKEN },
            password: RCE_PASSWORD,
            devId: 'c6fdc2019903ac3332f624b0b2c2fe2c733c3e74',
            signingPassword: 'drRCEVWP/++K5TYnTtuAfQ=='
        };

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
        const packages = await rd.listSideloadedPlugins({ device: options.device, password: options.password });
        return packages.filter(x => x.appType === 'dcl').map(x => x.archiveFileName);
    }

    /**
     * Build and sideload a channel onto the device
     */
    async function installChannel() {
        await rd.sideload({
            ...options,
            dir: rootDir,
            appType: 'channel'
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

        const { stagingDir: staged } = await rd.stage({ rootDir: libRootDir, files: options.files, out: `${stagingDir}-${name}` });
        await rd.zip({ dir: staged, out: `${outDir}/${name}.zip`, files: options.files });
        await rd.sideload({
            ...options,
            zip: `${outDir}/${name}.zip`,
            appType: 'dcl'
        });
    }

    /**
     * Build and sideload a BrightScript library (bs_libs) onto the device, modeled after the
     * `code-library` sample. Unlike SceneGraph complibs, these declare themselves with
     * `bs_libs_provided` + `no_source=1` and pull in their dependencies via `bs_libs_required`, but
     * they are hosted/installed the same way (published as their own `dcl` package) and deleted
     * individually via `deleteComponentLibrary`.
     *
     * @param name the library name (also its provided symbol and .brs file name)
     * @param requires the names of other libraries this one depends on (goes into bs_libs_required)
     */
    async function installBrightScriptLibrary(name: string, requires: string[] = []) {
        const libRootDir = s`${tempDir}/${name}`;
        //each library greets, then delegates to every library it requires, so the whole chain is exercised
        const requiredLibraryStatements = requires.map(dep => `library "${dep}.brs"`).join('\n');
        const delegationCalls = requires.map(dep => `    ${dep}_greet("Activated from ${name}")`).join('\n');
        writeFiles(libRootDir, [
            ['manifest', undent`
                title=${name}
                major_version=1
                minor_version=0
                build_version=1
                bs_libs_provided=${name}
                no_source=1
                ${requires.length > 0 ? `bs_libs_required=${requires.join(',')}` : ''}
                rsg_version=1.2
                ui_resolutions=hd
            `],
            [`libsource/${name}.brs`, undent`
                ${requiredLibraryStatements}
                '${COMPLIB_PADDING}
                function ${name}_greet(message as string) as void
                    ? "Hello from ${name}: " + message
                ${delegationCalls}
                end function
            `]
        ]);

        //the default file list only covers source/components/images/locale/manifest; a bs_libs
        //library keeps its code under libsource/, so grab everything to be sure it's packaged
        const { stagingDir: staged } = await rd.stage({ rootDir: libRootDir, files: ['**/*'], out: `${stagingDir}-${name}` });
        await rd.zip({ dir: staged, out: `${outDir}/${name}.zip`, files: ['**/*'] });
        await rd.sideload({
            ...options,
            zip: `${outDir}/${name}.zip`,
            appType: 'dcl'
        });
    }

    describe('deploy', () => {
        it('works', async () => {
            let response = await rd.sideload({ ...options, dir: rootDir });
            assert.equal(response.message, 'Successful sideload');
        });

        it('Presents nice message for 401 unauthorized status code', async function unauthorized() {
            //bumped from the LAN suite's 10s for cloud round-trip latency
            this.timeout(20_000);
            options.password = 'NOT_THE_PASSWORD';
            //unlike the LAN suite, the host in this message comes from the RCE instance url resolved
            //through the management api rather than from `options.device` directly (an RCE device
            //config has no `host` field), so it's captured in `before()` as `resolvedInstanceHost`
            await expectThrowsAsync(
                rd.sideload({ ...options, dir: rootDir }),
                `Unauthorized. Please verify credentials for host '${resolvedInstanceHost}'`
            );
        });
    });

    describe('publish', () => {
        it('works', async () => {
            const { stagingDir: staged } = await rd.stage({ rootDir: rootDir, files: options.files, out: stagingDir });
            const zipPath = `${outDir}/roku-deploy.zip`;
            await rd.zip({ dir: staged, out: zipPath, files: options.files });
            let response = await rd.sideload({ ...options, zip: zipPath });
            assert.equal(response.message, 'Successful sideload');
        });
    });

    describe('deployAndSignPackage', () => {
        //RCE: signing on an emulator instance is unverified (rekeying/signing a cloud device has not
        //been confirmed safe or even meaningful). Skip until that's confirmed; body kept as-is so the
        //structure survives for the later merge with device.spec.ts.
        it.skip('works', async () => {
            await rd.deleteDevChannel({ device: options.device, password: options.password });
            await rd.rekeyDevice({
                device: options.device,
                password: options.password,
                pkg: rekeySignedPackage,
                signingPassword: options.signingPassword,
                devId: options.devId
            });
            //stage+zip+sideload the app so there is a dev channel on the device to sign
            const { stagingDir: staged } = await rd.stage({ rootDir: rootDir, files: options.files, out: stagingDir });
            const zipPath = `${outDir}/roku-deploy.zip`;
            await rd.zip({ dir: staged, out: zipPath, files: options.files });
            await rd.sideload({ ...options, zip: zipPath });
            const { pkgPath } = await rd.createSignedPackage({
                device: options.device,
                password: options.password,
                signingPassword: options.signingPassword,
                devId: options.devId,
                manifestPath: `${rootDir}/manifest`
            });
            expectPathExists(pkgPath);
        });
    });

    describe('validateDeveloperPassword', () => {
        it('returns true when the password is correct', async () => {
            const result = await rd.validateDeveloperPassword({
                device: options.device,
                password: options.password
            });
            assert.strictEqual(result, true);
        });

        it('returns false when the password is wrong', async () => {
            const result = await rd.validateDeveloperPassword({
                device: options.device,
                password: 'NOT_THE_PASSWORD'
            });
            assert.strictEqual(result, false);
        });

        //RCE: this test is inherently host-addressed (an unreachable LAN ip). For a cloud device,
        //"unreachable" means a stopped/never-started instance, which is a different failure mode (and
        //one this suite's `before()` already guards against by refusing to run at all). Skip until
        //there's an RCE-appropriate equivalent (for example targeting a device id that doesn't exist).
        it.skip('throws DeviceUnreachableError for an offline host', async () => {
            await expectThrowsAsync(async () => {
                await rd.validateDeveloperPassword({
                    device: { host: '192.168.254.254' },
                    password: 'aaaa',
                    timeout: 2000
                });
            });
        });
    });

    describe('getDeviceInfo', () => {
        it('works', async () => {
            const info = await rd.getDeviceInfo({ device: options.device });
            assert.ok(info);
            assert.ok(info['software-version']);
        });

        it('normalizes types when enhanced', async () => {
            const info = await rd.getDeviceInfo({ device: options.device, enhance: true });
            assert.ok(info.softwareVersion);
            assert.strictEqual(typeof info.supportsEthernet, 'boolean');
        });
    });

    describe('getDevId', () => {
        it('works', async () => {
            const devId = await rd.getDevId(options);
            assert.ok(devId);
        });
    });

    describe('getEcpNetworkAccessMode', () => {
        //RCE: the instance's plain HTTP ECP query routes (which this call falls back to detect a
        //disabled setting) are not exposed on the instance api and 404; this needs a dedicated ECP2
        //route or a Roku-side fix before it can run against RCE.
        it.skip('works', async () => {
            const mode = await rd.getEcpNetworkAccessMode({ device: options.device });
            assert.ok([undefined, 'enabled', 'disabled', 'limited', 'permissive'].includes(mode));
        });
    });

    describe('pressHomeButton', () => {
        it('works', async () => {
            await rd.keyPress({ device: options.device, key: 'home' });
        });
    });

    describe('takeScreenshot', () => {
        it('works', async function takeScreenshot() {
            //this test waits on the debug console for a marker (up to 45s internally), so its ceiling
            //is driven by that wait rather than the observed happy-path runtime. Bumped from the LAN
            //suite's 60s to account for cloud round-trip latency on top of the same internal wait.
            this.timeout(90_000);

            //A screenshot only works when a side-loaded channel is actively running. Rather than
            //guessing that `deploy` left the app running, we make main.brs print a unique, timestamped
            //marker once its scene is shown, connect to the debug console (over the RCE instance's
            //telnet websocket instead of a raw tcp socket), and wait until we observe THAT marker.
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
            const sawMarker = waitForConsoleOutput(options.device, marker, 45000);

            await rd.sideload({ ...options, dir: rootDir });

            //the marker proves our freshly-deployed channel actually reached the "scene shown" point this run
            await sawMarker;

            //RCE: device.spec.ts also cross-checks via ECP's plain-HTTP `/query/active-app` that the
            //dev channel is the foregrounded app before asking for the screenshot. That route isn't
            //exposed on the instance api (see the getEcpNetworkAccessMode skip above), and there's no
            //confirmed ECP2 equivalent yet, so that cross-check is omitted here; the telnet marker
            //above already proves the freshly-deployed channel reached the "scene shown" point.

            //v4 captureScreenshot returns { buffer, filePath? }; pass `out: true` to also save to disk so we can assert the path exists
            const result = await rd.captureScreenshot({ device: options.device, password: options.password, out: true });
            expectPathExists(result.filePath);
        });
    });

    describe('convertToSquashfs', () => {
        it('works', async () => {
            await rd.sideload({ ...options, dir: rootDir });
            await rd.convertToSquashfs({ device: options.device, password: options.password });
        });
    });

    describe('deleteAllComponentLibraries', () => {
        it('works', async () => {
            await rd.deleteAllComponentLibraries({ device: options.device, password: options.password });
        });
    });

    describe('deleteInstalledChannel', () => {
        it('works', async () => {
            await rd.sideload({ ...options, dir: rootDir });
            await rd.deleteDevChannel({ device: options.device, password: options.password });
        });
    });

    describe('rebootDevice', () => {
        //RCE: what "reboot" does to an emulator instance is unverified and may kill the instance
        //mid-suite; skip until that's confirmed safe. Body kept as-is so the structure survives for
        //the later merge with device.spec.ts.
        it.skip('works', async function rebootDevice() {
            //a reboot takes the device offline for a while; allow time for it to come back
            this.timeout(180_000);
            //use a short per-request timeout so the reboot POST can't hang open past the device going
            //down; without this it would inherit the 150s default and could orphan a socket if mocha's
            //test-timeout fired first.
            await rd.rebootDevice({ ...options, timeout: REQUEST_TIMEOUT });
            //wait until the device is reachable again so the next test doesn't run mid-reboot
            await waitForDeviceOnline(options.device);
        });
    });

    describe('checkForUpdate', () => {
        //checkForUpdate requires firmware >= this version; below it, it throws UnsupportedFirmwareVersionError
        const MIN_FIRMWARE = '15.0.4';

        it('works', async function checkForUpdate() {
            //triggers a real update check against Roku's servers, which can be slow and can sometimes
            //trigger a reboot, so allow generous time for the device to come back afterward. Bumped
            //from the LAN suite's 240s for cloud round-trip latency.
            this.timeout(300_000);

            //Every device call below uses an explicit short `timeout` so no underlying needle request can
            //hang open indefinitely (the default is 150s). This guarantees each request either resolves or
            //rejects and closes its socket on its own, rather than being orphaned if mocha's test-timeout
            //were to fire mid-request.
            const reqOptions = { ...options, timeout: REQUEST_TIMEOUT };

            //we don't know which firmware the target instance runs, so ask it and decide up-front
            //whether checkForUpdate should succeed or be rejected by the version gate.
            const softwareVersion = (await rd.getDeviceInfo({ device: options.device, timeout: REQUEST_TIMEOUT }))['software-version'];
            const supported = !!softwareVersion && semver.gte(semver.coerce(softwareVersion), MIN_FIRMWARE);

            if (supported) {
                console.log(`[checkForUpdate] device firmware ${softwareVersion} >= ${MIN_FIRMWARE}; expecting success`);
                const result = await rd.checkForUpdate(reqOptions);
                assert.ok(result, 'expected a response from checkForUpdate');
                //checkForUpdate can trigger a reboot; make sure the device is back before the next test
                await waitForDeviceOnline(options.device);
            } else {
                console.log(`[checkForUpdate] device firmware ${softwareVersion} < ${MIN_FIRMWARE}; expecting UnsupportedFirmwareVersionError`);
                let thrown: Error;
                try {
                    await rd.checkForUpdate(reqOptions);
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

    describe('deleteAllSideloadedPlugins', function deleteAllTests() {
        //these tests do several device round-trips (install + verify + delete), each paying cloud
        //round-trip latency plus a fresh instance-url resolution (`rd` is recreated in `beforeEach`).
        //~2x the slowest observed case in this block against RCE (~17.7s for the four-plugin test).
        this.timeout(40_000);

        it('deletes a single channel', async () => {
            //start clean
            await rd.deleteAllSideloadedPlugins(options);

            await installChannel();

            //the channel should now be installed
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 1,
                complibs: 0
            });

            await rd.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rd.listSideloadedPlugins({ device: options.device, password: options.password })).to.eql([]);
        });

        it('deletes a single component library', async () => {
            //start clean
            await rd.deleteAllSideloadedPlugins(options);

            await installComponentLibrary('a');

            //the complib should now be installed
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 0,
                complibs: 1
            });

            await rd.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rd.listSideloadedPlugins({ device: options.device, password: options.password })).to.eql([]);
        });

        it('deletes a channel and a component library together', async () => {
            //start clean
            await rd.deleteAllSideloadedPlugins(options);

            await installChannel();
            await installComponentLibrary('complib1');

            //both should now be installed
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 1,
                complibs: 1
            });

            await rd.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rd.listSideloadedPlugins({ device: options.device, password: options.password })).to.eql([]);
        });

        it('deletes a channel and two component libraries together', async () => {
            //start clean
            await rd.deleteAllSideloadedPlugins(options);

            await installChannel();
            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');

            //all three should now be installed
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 1,
                complibs: 2
            });

            await rd.deleteAllSideloadedPlugins(options);

            //nothing should be installed anymore
            expect(await rd.listSideloadedPlugins({ device: options.device, password: options.password })).to.eql([]);
        });
    });

    describe('install size boundary', function installSizeBoundary() {
        //Roku firmware rejects sideloaded zips below a hard minimum size (512 bytes on firmware 15.x, for
        //both channels and complibs) with "Unzip failed. Invalid or corrupt zip archive." Each test builds
        //a zip of exactly (BOUNDARY - 1) and exactly BOUNDARY bytes and asserts the former fails, the latter
        //installs. ~2x the slowest observed case in this block against RCE (~13.6s).
        this.timeout(30_000);
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
                const { stagingDir: staged } = await rd.stage({ rootDir: dir, files: files, out: s`${dir}/staging` });
                await rd.zip({ dir: staged, out: s`${dir}/app.zip`, files: files });
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
                await rd.sideload({ ...options, zip: s`${dir}/app.zip`, appType: appType, failOnCompileError: true });
                return true;
            } catch {
                return false;
            }
        }

        async function assertBoundary(label: string, dir: string, files: string[], appType: 'channel' | 'dcl', writeProject: (pad: string) => void) {
            process.chdir(cwd); //beforeEach parks us inside the shared .tmp
            fsExtra.removeSync(dir);
            fsExtra.ensureDirSync(dir);
            await rd.deleteAllSideloadedPlugins(options);

            const below = await installsAtSize(dir, files, appType, writeProject, BOUNDARY - 1);
            const at = await installsAtSize(dir, files, appType, writeProject, BOUNDARY);
            await rd.deleteAllSideloadedPlugins(options);

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
            await rd.deleteAllSideloadedPlugins(options);

            //a zip below the minimum installable size; the device rejects it as a corrupt zip
            const size = BOUNDARY - 1;
            await buildExactZip(dir, ['manifest', 'source/**/*'], (pad) => {
                fsExtra.outputFileSync(s`${dir}/manifest`, 'title=a');
                fsExtra.outputFileSync(s`${dir}/source/main.brs`, `sub Main()\n'${pad}\nend sub`);
            }, size);

            let thrown: Error;
            try {
                await rd.sideload({ ...options, zip: s`${dir}/app.zip`, appType: 'channel', failOnCompileError: true });
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

    describe.skip('install app + libs, then delete everything', function installDeleteEverything() {
        //this reproduces an intermittent socket hangup seen when deleting component libraries. we install
        //a chain of interdependent BrightScript libraries (modeled after the `code-library` sample) plus
        //an app that requires them, then delete the app followed by each library one by one. after every
        //delete we immediately list the installed plugins; a hung socket surfaces on that next request.
        this.timeout(300_000);

        //the dependency chain, modeled after the `code-library` sample: echo depends on delta, delta on
        //charlie, charlie on beta, beta on alpha. alpha is the leaf. The app requires all five.
        //install order is leaf-first so each library's dependencies already exist when it's built.
        const LIB_DEPENDENCY_CHAIN = ['echo', 'delta', 'charlie', 'beta', 'alpha'];
        //leaf-first: alpha (no deps) up to echo (depends on the whole chain below it)
        const INSTALL_ORDER = [...LIB_DEPENDENCY_CHAIN].reverse();

        it('deletes the app then each component library one by one without a socket hangup', async () => {
            //start from a known-clean device so pre-existing plugins don't skew the assertions
            await rd.deleteAllSideloadedPlugins(options);

            //install each library leaf-first; each one requires the library immediately below it in the chain
            for (let i = 0; i < INSTALL_ORDER.length; i++) {
                const name = INSTALL_ORDER[i];
                //everything already installed (leaf-first) is a valid dependency; wire up the immediate one
                const requires = i > 0 ? [INSTALL_ORDER[i - 1]] : [];
                await installBrightScriptLibrary(name, requires);
            }

            //now install the app that requires the whole chain of libraries
            writeFiles(rootDir, [
                ['manifest', undent`
                    title=RokuDeployTestChannel
                    major_version=1
                    minor_version=0
                    build_version=1
                    bs_libs_required=${LIB_DEPENDENCY_CHAIN.join(',')}
                    rsg_version=1.2
                    ui_resolutions=hd
                `]
            ]);
            await rd.sideload({
                ...options,
                dir: rootDir,
                appType: 'channel',
                //enable the debug protocol
                remoteDebug: true,
                //necessary for capturing compile errors from the protocol (has no effect on telnet)
                remoteDebugConnectEarly: false,
                //we don't want to fail if there were compile errors...we'll let our compile error processor handle that
                failOnCompileError: true
            });

            //everything should be installed now: the channel plus all five component libraries
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 1,
                complibs: LIB_DEPENDENCY_CHAIN.length
            });

            //delete the app (the dev channel). the list afterward proves the request didn't hang the socket.
            await rd.deleteDevChannel({ device: options.device, password: options.password });
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 0,
                complibs: LIB_DEPENDENCY_CHAIN.length
            });

            //delete the app AGAIN when there is no dev channel installed. this redundant delete is a
            //suspected trigger for the flaky socket hangup, so exercise it explicitly and confirm the
            //very next request still succeeds.
            await rd.deleteDevChannel({ device: options.device, password: options.password });
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 0,
                complibs: LIB_DEPENDENCY_CHAIN.length
            });

            //now delete each component library one by one until they're all gone. after each delete we
            //list the installed plugins right away; if deleting a complib hangs the socket, that list
            //request is where it surfaces.
            let remaining = await getInstalledComponentLibraryFileNames();
            let expectedRemaining = remaining.length;
            for (const fileName of remaining) {
                await rd.deleteComponentLibrary({
                    device: options.device,
                    password: options.password,
                    fileName: fileName
                });
                expectedRemaining--;

                const afterDelete = await getInstalledComponentLibraryFileNames();
                expect(afterDelete).to.not.include(fileName);
                expect(afterDelete).to.have.lengthOf(expectedRemaining);
            }

            //everything is gone
            expect(await rd.listSideloadedPlugins({ device: options.device, password: options.password })).to.eql([]);

            //one more delete against an already-empty device to be sure the "delete when nothing is
            //installed" path doesn't hang the socket for the next caller
            await rd.deleteComponentLibrary({
                device: options.device,
                password: options.password,
                fileName: remaining[0] ?? 'nonexistent.zip'
            });
            expect(await rd.listSideloadedPlugins({ device: options.device, password: options.password })).to.eql([]);
        });
    });

    describe.skip('delete-order reboot hunt', function deleteOrderRebootHunt() {
        //Bug hunt: an interdependent app + library chain (modeled after the `code-library` sample) is
        //suspected of rebooting the device when its pieces are deleted in certain orders. We install the
        //full set in the ONLY valid build order (leaf-first: charlie, beta, alpha, then the app that
        //requires all three) and then try EVERY deletion permutation of the four pieces, watching for an
        //unexpected reboot after each individual delete.
        //
        //The dependency shape mirrors the sample exactly:
        //  - charlie: leaf, requires nothing
        //  - beta:    requires charlie
        //  - alpha:   requires beta AND charlie
        //  - app:     a channel that requires alpha, beta, and charlie
        //
        //24 permutations x (reinstall the whole set + 4 deletes) against a real device is slow; give it lots of room.
        this.timeout(30 * 60 * 1000);

        const CHARLIE = 'charlie';
        const BETA = 'beta';
        const ALPHA = 'alpha';
        const APP = 'app';

        //map of library name -> the archiveFileName the device assigned it, captured at install time so we
        //can target each complib in deleteComponentLibrary regardless of how the device names the file.
        let libFileNames: Record<string, string>;

        //install the whole set in the only valid order (leaf-first), capturing each complib's archiveFileName.
        //Returns once the app (channel) + all three libraries are installed.
        async function installFullSet() {
            await rd.deleteAllSideloadedPlugins(options);
            libFileNames = {};

            //leaf-first so each library's dependencies already exist when it's built/installed
            for (const [name, requires] of [
                [CHARLIE, []],
                [BETA, [CHARLIE]],
                [ALPHA, [BETA, CHARLIE]]
            ] as Array<[string, string[]]>) {
                const before = new Set(await getInstalledComponentLibraryFileNames());
                await installBrightScriptLibrary(name, requires);
                const after = await getInstalledComponentLibraryFileNames();
                const added = after.filter(x => !before.has(x));
                //exactly one new complib should have appeared: the one we just installed
                expect(added, `expected installing "${name}" to add exactly one complib`).to.have.lengthOf(1);
                libFileNames[name] = added[0];
            }

            //now the app: a channel that requires the whole library chain
            writeFiles(rootDir, [
                ['manifest', undent`
                    title=RokuDeployTestChannel
                    major_version=1
                    minor_version=0
                    build_version=1
                    bs_libs_required=${[ALPHA, BETA, CHARLIE].join(',')}
                    rsg_version=1.2
                    ui_resolutions=hd
                `]
            ]);
            await rd.sideload({
                ...options,
                dir: rootDir,
                appType: 'channel',
                failOnCompileError: true
            });

            //sanity: channel + all three complibs are present
            expect(countByType(await rd.listSideloadedPlugins({ device: options.device, password: options.password }))).to.eql({
                channels: 1,
                complibs: 3
            });
        }

        //delete a single piece by name. The app is a channel (deleteInstalledChannel); the libs are
        //complibs (deleteComponentLibrary by their captured archiveFileName).
        async function deletePiece(name: string) {
            if (name === APP) {
                await rd.deleteDevChannel({ device: options.device, password: options.password, timeout: REQUEST_TIMEOUT });
            } else {
                await rd.deleteComponentLibrary({
                    device: options.device,
                    password: options.password,
                    fileName: libFileNames[name]
                });
            }
        }

        //all 24 delete orderings of the four pieces
        function permutations<T>(items: T[]): T[][] {
            if (items.length <= 1) {
                return [items];
            }
            const result: T[][] = [];
            for (let i = 0; i < items.length; i++) {
                const rest = [...items.slice(0, i), ...items.slice(i + 1)];
                for (const p of permutations(rest)) {
                    result.push([items[i], ...p]);
                }
            }
            return result;
        }

        it('does not reboot the device under any deletion order', async () => {
            const orders = permutations([APP, ALPHA, BETA, CHARLIE]);
            //orders whose deletion caused an unexpected reboot, with the exact step that triggered it
            const rebootTriggers: Array<{ order: string[]; afterDeleting: string; step: number }> = [];

            for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
                const order = orders[orderIndex];
                console.log(`[reboot-hunt] permutation ${orderIndex + 1}/${orders.length}: installing full set, then deleting in order [${order.join(', ')}]`);
                await installFullSet();
                console.log(`[reboot-hunt]   full set installed (charlie, beta, alpha, app)`);

                //baseline uptime; a later read that is LOWER means the device rebooted in between
                let priorUptime = await getDeviceUptime(options.device);

                for (let step = 0; step < order.length; step++) {
                    const piece = order[step];
                    console.log(`[reboot-hunt]   step ${step + 1}/${order.length}: deleting "${piece}"...`);
                    await deletePiece(piece);

                    const nowUptime = await getDeviceUptime(options.device);
                    //undefined = device unreachable (very likely mid-reboot); a drop in uptime = it rebooted
                    const rebooted = nowUptime === undefined || (priorUptime !== undefined && nowUptime < priorUptime);
                    if (rebooted) {
                        console.log(`[reboot-hunt]   !! REBOOT DETECTED after deleting "${piece}" (step ${step + 1}) in order [${order.join(', ')}]; waiting for device to come back...`);
                        rebootTriggers.push({ order: order, afterDeleting: piece, step: step + 1 });
                        //let the device fully recover before the next permutation so we don't test mid-reboot
                        await waitForDeviceOnline(options.device);
                        console.log(`[reboot-hunt]   device back online; moving to next permutation`);
                        break;
                    }
                    console.log(`[reboot-hunt]   deleted "${piece}" OK (uptime ${nowUptime ?? 'n/a'}s, no reboot)`);
                    priorUptime = nowUptime;
                }
            }

            console.log(`[reboot-hunt] done: ${orders.length} permutations tested, ${rebootTriggers.length} caused a reboot`);
            //leave the device clean for the next test
            await rd.deleteAllSideloadedPlugins(options);

            expect(
                rebootTriggers,
                `these deletion orders rebooted the device:\n` +
                rebootTriggers.map(t => `  - after deleting "${t.afterDeleting}" (step ${t.step}) in [${t.order.join(', ')}]`).join('\n')
            ).to.eql([]);
        });
    });

    describe('deleteComponentLibrary', function deleteComponentLibraryTests() {
        //these tests install several complibs and then delete them one at a time. ~2x the slowest
        //observed case in this block against RCE (~27.1s for the channel+complibs test).
        this.timeout(60_000);

        it('deletes several component libraries one by one', async () => {
            //start clean
            await rd.deleteAllSideloadedPlugins(options);

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
                await rd.deleteComponentLibrary({
                    device: options.device,
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
            await rd.deleteAllSideloadedPlugins(options);

            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');

            const fileNames = await getInstalledComponentLibraryFileNames();
            expect(fileNames).to.have.lengthOf(2);

            //delete just the first complib
            const [toDelete, toKeep] = fileNames;
            await rd.deleteComponentLibrary({
                device: options.device,
                password: options.password,
                fileName: toDelete
            });

            //only the second complib should remain
            expect(await getInstalledComponentLibraryFileNames()).to.eql([toKeep]);

            //clean up
            await rd.deleteAllSideloadedPlugins(options);
        });

        it('deletes a component library without affecting an installed channel', async () => {
            //start clean
            await rd.deleteAllSideloadedPlugins(options);

            //install a channel alongside the complibs
            await rd.sideload({
                ...options,
                dir: rootDir,
                appType: 'channel'
            });
            await installComponentLibrary('complib1');
            await installComponentLibrary('complib2');

            expect(await getInstalledComponentLibraryFileNames()).to.have.lengthOf(2);

            //delete the complibs one by one
            for (const fileName of await getInstalledComponentLibraryFileNames()) {
                await rd.deleteComponentLibrary({
                    device: options.device,
                    password: options.password,
                    fileName: fileName
                });
            }

            //all complibs gone, but the channel should still be installed
            const packages = await rd.listSideloadedPlugins({ device: options.device, password: options.password });
            expect(packages.filter(x => x.appType === 'dcl')).to.eql([]);
            expect(packages.filter(x => x.appType === 'channel')).to.have.lengthOf(1);

            //clean up
            await rd.deleteAllSideloadedPlugins(options);
        });
    });
});

/**
 * Connect to the Roku debug console (the RCE instance's telnet websocket, rather than a raw tcp
 * socket on port 8085) and resolve once a line containing `marker` is observed. Rejects if the marker
 * isn't seen within `timeout` ms. Used to prove that a freshly-deployed channel actually reached a
 * known point in its own code during THIS test run.
 *
 * The telnet socket's teardown is registered in `cleanups` so the `afterEach` hook always tears it
 * down (even on the happy path), otherwise the open connection keeps the mocha process alive after
 * the suite finishes.
 */
function waitForConsoleOutput(device: DeviceConfig, marker: string, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const socket = createTelnetSocket({ device: device, channel: 'brightscript-console' });
        let buffer = '';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out after ${timeout}ms waiting for marker "${marker}" on the debug console`));
        }, timeout);
        //don't let this timer alone keep the event loop (and thus the process) alive
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
        socket.connect();
    });
}

/**
 * Wait for a device to be reachable again by polling its device-info until it responds. Used after
 * operations that reboot the device (rebootDevice, and sometimes checkForUpdate) so the next test
 * doesn't run against a device that's still rebooting.
 *
 * @param graceMs how long to wait before the first poll, giving the device time to actually go down
 *   after the reboot was issued (so we don't immediately see the still-alive pre-reboot device)
 */
async function waitForDeviceOnline(device: DeviceConfig, timeoutMs = 120_000, intervalMs = 3000, graceMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    //give the device a moment to actually start going down before we begin polling
    await sleep(graceMs);
    let lastError: Error;
    while (Date.now() < deadline) {
        try {
            await helperRd.getDeviceInfo({ device: device, timeout: intervalMs });
            //a successful device-info query means the device is up and responsive again
            return;
        } catch (e) {
            lastError = e as Error;
            await sleep(intervalMs);
        }
    }
    throw new Error(`Device did not come back online within ${timeoutMs}ms. Last error: ${lastError?.message}`);
}

/**
 * Read the device's current uptime (seconds since boot). Used to detect an unexpected reboot: if
 * uptime goes DOWN between two reads, the device rebooted in between. Returns undefined if the device
 * is unreachable (e.g. mid-reboot), which the caller can treat as a reboot in progress.
 */
async function getDeviceUptime(device: DeviceConfig): Promise<number | undefined> {
    try {
        const info = await helperRd.getDeviceInfo({ device: device, enhance: true, timeout: 15_000 });
        //`enhance` coerces uptime to a number; guard anyway in case a device omits it
        return typeof info.uptime === 'number' ? info.uptime : undefined;
    } catch {
        return undefined;
    }
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
