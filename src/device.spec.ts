import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as net from 'net';
import * as http from 'http';
import * as semver from 'semver';
import * as rokuDeploy from './index';
import * as errors from './Errors';
import { cwd, expectPathExists, expectThrowsAsync, outDir, rootDir, tempDir, writeFiles } from './testUtils.spec';
import undent from 'undent';

//socket teardown callbacks, drained in afterEach so the suite doesn't hang open
const cleanups: Array<() => void> = [];

//explicit short per-request timeout for the reboot-prone tests. The roku-deploy default is 150s; a
//short timeout guarantees any request against an unresponsive/rebooting device aborts (and closes its
//socket) quickly instead of hanging open and keeping the mocha process alive after the run.
const REQUEST_TIMEOUT = 15_000;

//these tests are run against an actual roku device and need to be run on our self-hosted runners.
describe('device', function device() {
    let options: rokuDeploy.RokuDeployOptions;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);
        options = rokuDeploy.getOptions({
            outDir: outDir,
            host: '192.168.1.31',
            retainDeploymentArchive: true,
            password: 'aaaa',
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

    this.timeout(20000);

    describe('deploy', () => {
        it('works', async () => {
            options.retainDeploymentArchive = true;
            let response = await rokuDeploy.deploy(options);
            assert.equal(response.message, 'Successful deploy');
        });

        it('Presents nice message for 401 unauthorized status code', async () => {
            this.timeout(20000);
            options.password = 'NOT_THE_PASSWORD';
            await expectThrowsAsync(
                rokuDeploy.deploy(options),
                `Unauthorized. Please verify credentials for host '${options.host}'`
            );
        });
    });

    describe('publish', () => {
        it('works', async () => {
            await rokuDeploy.createPackage(options);
            let response = await rokuDeploy.publish(options);
            assert.equal(response.message, 'Successful deploy');
        });
    });

    describe('deployAndSignPackage', () => {
        it('works', async () => {
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
            this.timeout(60000);

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
        it('works', async () => {
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

    describe('rebootDevice', () => {
        it('works', async function rebootDevice() {
            //a reboot takes the device offline for a while; allow time for it to come back
            this.timeout(180_000);
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
            //trigger a reboot, so allow generous time for the device to come back afterward
            this.timeout(240_000);

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
