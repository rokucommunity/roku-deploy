import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as rokuDeploy from './index';
import { cwd, expectPathExists, expectThrowsAsync, outDir, rootDir, tempDir, writeFiles } from './testUtils.spec';
import undent from 'undent';

//these tests are run against an actual roku device. These cannot be enabled when run on the CI server
describe('device', function device() {
    let options: rokuDeploy.RokuDeployOptions;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);
        options = rokuDeploy.getOptions({
            outDir: outDir,
            host: '192.168.1.93',
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
                Sub RunUserInterface()
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
            `]
        ]);
    });

    afterEach(() => {
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
        it('works', async () => {
            await rokuDeploy.deploy(options);
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
        it('works', async () => {
            this.timeout(60000);
            await rokuDeploy.rokuDeploy.rebootDevice(options);
        });
    });

    describe('checkForUpdate', () => {
        it('works', async () => {
            await rokuDeploy.rokuDeploy.checkForUpdate(options);
        });
    });
});
