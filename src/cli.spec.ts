import * as childProcess from 'child_process';
import { cwd, expectPathExists, expectThrowsAsync, rootDir, stagingDir, tempDir, outDir } from './testUtils.spec';
import * as fsExtra from 'fs-extra';
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { rokuDeploy } from './index';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { CreateSignedPackageCommand } from './commands/CreateSignedPackageCommand';
import { DeleteDevChannelCommand } from './commands/DeleteDevChannelCommand';
import { CaptureScreenshotCommand } from './commands/CaptureScreenshotCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';
import { RceStartDeviceCommand } from './commands/RceStartDeviceCommand';
import { RceStopDeviceCommand } from './commands/RceStopDeviceCommand';
import type { RceDevice } from './RceManagementClient';
import { RceManagementClient } from './RceManagementClient';
import { standardizePath as s, util } from './util';

const sinon = createSandbox();

function execSync(command: string) {
    const output = childProcess.execSync(command, { cwd: tempDir });
    process.stdout.write(output);
    return output;
}
describe('cli', function cli() {
    //all cli tests spawn `node dist/cli.js` via execSync, which can exceed the default 2s timeout
    this.timeout(60_000);

    before(() => {
        execSync('npm run build');
    });

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        //most tests depend on a manifest file existing, so write an empty one
        fsExtra.outputFileSync(`${rootDir}/manifest`, '');
        sinon.restore();
    });
    afterEach(() => {
        fsExtra.removeSync(tempDir);
        sinon.restore();
    });

    it('Successfully runs stage', () => {
        //make the files
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

        expect(() => {
            execSync(`node ${cwd}/dist/cli.js stage --out ${stagingDir} --rootDir ${rootDir}`);
        }).to.not.throw();
    });

    it('Successfully copies rootDir folder to staging folder', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

        execSync(`node ${cwd}/dist/cli.js stage --rootDir ${rootDir} --out ${stagingDir}`);

        expectPathExists(`${stagingDir}/source/main.brs`);
    });

    it('Converts to squashfs', async () => {
        const stub = sinon.stub(rokuDeploy, 'convertToSquashfs').callsFake(async () => {
            return Promise.resolve();
        });

        const command = new ConvertToSquashfsCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Rekeys a device', async () => {
        const stub = sinon.stub(rokuDeploy, 'rekeyDevice').callsFake(async () => {
            return Promise.resolve();
        });

        const command = new RekeyDeviceCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            pkg: `${tempDir}/testSignedPackage.pkg`,
            signingPassword: '12345',
            rootDir: rootDir,
            devId: 'abcde'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536',
            pkg: s`${tempDir}/testSignedPackage.pkg`,
            signingPassword: '12345',
            rootDir: rootDir,
            devId: 'abcde'
        });
    });

    it('Rekeys a device using the provided cwd', async () => {
        const stub = sinon.stub(rokuDeploy, 'rekeyDevice').callsFake(async () => {
            return Promise.resolve();
        });

        const command = new RekeyDeviceCommand();
        await command.run({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Signs an existing package', async () => {
        const stub = sinon.stub(rokuDeploy, 'createSignedPackage').callsFake(async () => {
            return Promise.resolve({ pkgPath: '' });
        });

        const command = new CreateSignedPackageCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            signingPassword: undefined,
            stagingDir: stagingDir
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536',
            signingPassword: undefined,
            stagingDir: stagingDir
        });
    });

    it('Signs an existing package using the provided cwd', async () => {
        const stub = sinon.stub(rokuDeploy, 'createSignedPackage').callsFake(async () => {
            return Promise.resolve({ pkgPath: '' });
        });

        const command = new CreateSignedPackageCommand();
        await command.run({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Deletes an installed channel', async () => {
        const stub = sinon.stub(rokuDeploy, 'deleteDevChannel').callsFake(async () => {
            return Promise.resolve({ statusCode: 200, headers: {}, body: '', request: { url: '', method: 'POST' } });
        });

        const command = new DeleteDevChannelCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Takes a screenshot', async () => {
        const stub = sinon.stub(rokuDeploy, 'captureScreenshot').callsFake(async () => {
            return Promise.resolve({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });
        });

        const command = new CaptureScreenshotCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Takes a screenshot using the provided cwd', async () => {
        const stub = sinon.stub(rokuDeploy, 'captureScreenshot').callsFake(async () => {
            return Promise.resolve({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });
        });

        const command = new CaptureScreenshotCommand();
        await command.run({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Device info arguments are correct', async () => {
        const stub = sinon.stub(rokuDeploy, 'getDeviceInfo').callsFake(async () => {
            return Promise.resolve({
                response: {},
                body: {}
            });
        });

        const command = new GetDeviceInfoCommand();
        await command.run({
            host: '1.2.3.4'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4'
        });
    });

    it('Prints device info to console', async () => {
        let consoleOutput = '';
        sinon.stub(console, 'log').callsFake((...args) => {
            consoleOutput += args.join(' ') + '\n';
        });
        sinon.stub(rokuDeploy, 'getDeviceInfo').returns(Promise.resolve({
            'device-id': '1234',
            'serial-number': 'abcd'
        }));
        await new GetDeviceInfoCommand().run({
            host: '1.2.3.4'
        });

        // const consoleOutputObject: Record<string, string> = {
        //     'device-id': '1234',
        //     'serial-number': 'abcd'
        // };

        expect(consoleOutput).to.eql([
            'Name              Value             ',
            '---------------------------',
            'device-id         1234              ',
            'serial-number     abcd              \n'
        ].join('\n'));
    });

    it('Gets dev id', async () => {
        const stub = sinon.stub(rokuDeploy, 'getDevId').callsFake(async () => {
            return Promise.resolve({ devId: '' });
        });

        const command = new GetDevIdCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Zips a folder', () => {
        execSync(`node ${cwd}/dist/cli.js zip --dir ${rootDir} --out ${outDir}/roku-deploy.zip`);

        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    describe('rce', () => {
        /* eslint-disable camelcase -- the RCE management api uses snake_case fields */
        function makeDevice(overrides?: Partial<RceDevice>): RceDevice {
            return {
                id: 5,
                name: 'my-device',
                device_type: 'tv',
                status: 'shutdown',
                created_at: '2026-01-01',
                last_snapshot_id: 11,
                firmware_version_id: 'fw-device',
                ...overrides
            };
        }

        beforeEach(() => {
            sinon.stub(console, 'log');
        });

        it('starts a device with explicit options', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));
            const listSnapshotsStub = sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([]);

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshotId: 99,
                firmwareVersionId: 'fw-1',
                maxRuntime: 120
            });

            expect(startStub.getCall(0).args[0]).to.eql({
                deviceId: 5,
                start: {
                    snapshot_id: 99,
                    firmware_version_id: 'fw-1',
                    max_runtime: 120
                }
            });
            //explicit snapshot and firmware means no snapshot lookup was needed
            expect(listSnapshotsStub.called).to.be.false;
        });

        it('defaults the snapshot to the live one and the firmware to that snapshot\'s', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 10, live: false, base: false, created_at: '2026-01-01', firmware_version_id: 'fw-old' },
                { id: 12, live: true, base: false, created_at: '2026-01-02', firmware_version_id: 'fw-live' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(startStub.getCall(0).args[0]).to.eql({
                deviceId: 5,
                start: {
                    snapshot_id: 12,
                    firmware_version_id: 'fw-live',
                    max_runtime: 3600
                }
            });
        });

        it('falls back to the device firmware, then the first for the device type', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(
                makeDevice({ firmware_version_id: null })
            );
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, created_at: '2026-01-02' }
            ]);
            sinon.stub(RceManagementClient.prototype, 'listFirmwareVersions').resolves([
                { firmware_version_id: 'fw-stb', device_type: 'stb' },
                { firmware_version_id: 'fw-tv', device_type: 'tv' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(startStub.getCall(0).args[0].start.firmware_version_id).to.equal('fw-tv');
        });

        it('uses the last snapshot when none is live, and the device firmware when the snapshot has none', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 11, live: false, base: false, created_at: '2026-01-01' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(startStub.getCall(0).args[0].start).to.eql({
                snapshot_id: 11,
                firmware_version_id: 'fw-device',
                max_runtime: 3600
            });
        });

        it('looks up snapshots for the firmware when only the snapshotId is explicit', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            const listSnapshotsStub = sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, created_at: '2026-01-02', firmware_version_id: 'fw-snap' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshotId: 12
            });

            expect(listSnapshotsStub.callCount).to.equal(1);
            expect(startStub.getCall(0).args[0].start.firmware_version_id).to.equal('fw-snap');
        });

        it('uses the device firmware when the explicit snapshotId is not in the snapshot list', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, created_at: '2026-01-02', firmware_version_id: 'fw-snap' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshotId: 99
            });

            expect(startStub.getCall(0).args[0].start.firmware_version_id).to.equal('fw-device');
        });

        it('throws when no firmware version is available for the device type', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(
                makeDevice({ firmware_version_id: null })
            );
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, created_at: '2026-01-02' }
            ]);
            sinon.stub(RceManagementClient.prototype, 'listFirmwareVersions').resolves([
                { firmware_version_id: 'fw-stb', device_type: 'stb' }
            ]);

            await expectThrowsAsync(
                new RceStartDeviceCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5 }),
                `No firmware version is available for device type 'tv'`
            );
        });

        it('resolves the device by esn', async () => {
            sinon.stub(RceManagementClient.prototype, 'listDevices').resolves([
                makeDevice({ id: 4, serial_number: 'X001' }),
                makeDevice({ id: 5, serial_number: 'X123' })
            ]);
            const stopStub = sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStopDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                esn: 'X123'
            });

            expect(stopStub.getCall(0).args[0]).to.eql({ deviceId: 5 });
        });

        it('throws when no token is available', async () => {
            await expectThrowsAsync(
                new RceStartDeviceCommand().run({ cwd: tempDir, deviceId: 5 }),
                'An RCE token is required. Pass --token or set "rceToken" in rokudeploy.json'
            );
        });

        it('reads the token from rokudeploy.json', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { rceToken: 'from-config' });
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice({ status: 'running' }));
            const stopStub = sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStopDeviceCommand().run({
                cwd: tempDir,
                deviceId: 5
            });

            expect(stopStub.called).to.be.true;
        });

        it('throws when neither deviceId nor esn is provided', async () => {
            await expectThrowsAsync(
                new RceStopDeviceCommand().run({ cwd: tempDir, token: 'abc' }),
                'A device is required. Pass --deviceId or --esn'
            );
        });

        it('throws when the esn matches no device', async () => {
            sinon.stub(RceManagementClient.prototype, 'listDevices').resolves([]);

            await expectThrowsAsync(
                new RceStopDeviceCommand().run({ cwd: tempDir, token: 'abc', esn: 'X999' }),
                `No RCE device found with esn 'X999'`
            );
        });

        it('throws when the device has no snapshot to start from', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(
                makeDevice({ last_snapshot_id: null })
            );
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([]);

            await expectThrowsAsync(
                new RceStartDeviceCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5 }),
                `Device 'my-device' has no snapshot to start from; create a snapshot before starting it`
            );
        });

        it('start --wait polls until the device is running', async () => {
            sinon.stub(util, 'sleep').resolves();
            const getDeviceStub = sinon.stub(RceManagementClient.prototype, 'getDevice');
            //first call resolves the target device, later calls are the --wait polling
            getDeviceStub.onCall(0).resolves(makeDevice());
            getDeviceStub.onCall(1).resolves(makeDevice({ status: 'pending' }));
            getDeviceStub.onCall(2).resolves(makeDevice({
                status: 'running',
                running_device: {
                    id: 1,
                    creator_id: 'user-1',
                    created_at: '2026-01-03',
                    snapshot_id: 11,
                    instance_uuid: 'uuid-1',
                    firmware_version_id: 'fw-device',
                    max_runtime: 3600,
                    instance_api_url: 'https://instance.example.com'
                }
            }));
            sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshotId: 11,
                firmwareVersionId: 'fw-device',
                wait: true
            });

            expect(getDeviceStub.callCount).to.equal(3);
        });

        it('stop --wait polls until the device is shut down', async () => {
            sinon.stub(util, 'sleep').resolves();
            const getDeviceStub = sinon.stub(RceManagementClient.prototype, 'getDevice');
            getDeviceStub.onCall(0).resolves(makeDevice({ status: 'running' }));
            getDeviceStub.onCall(1).resolves(makeDevice({ status: 'running' }));
            getDeviceStub.onCall(2).resolves(makeDevice({ status: 'shutdown' }));
            sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'running' }));

            await new RceStopDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                wait: true
            });

            expect(getDeviceStub.callCount).to.equal(3);
        });

        it('start --wait throws when the timeout elapses', async () => {
            sinon.stub(util, 'sleep').resolves();
            const getDeviceStub = sinon.stub(RceManagementClient.prototype, 'getDevice');
            getDeviceStub.onCall(0).resolves(makeDevice());
            getDeviceStub.onCall(1).resolves(makeDevice({ status: 'pending' }));
            sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await expectThrowsAsync(
                new RceStartDeviceCommand().run({
                    cwd: tempDir,
                    token: 'abc',
                    deviceId: 5,
                    snapshotId: 11,
                    firmwareVersionId: 'fw-device',
                    wait: true,
                    waitTimeout: 0
                }),
                `Timed out after 0 seconds waiting for device 5 to reach status 'running' (current status 'pending')`
            );
        });

        it('stop --wait throws when the timeout elapses', async () => {
            sinon.stub(util, 'sleep').resolves();
            const getDeviceStub = sinon.stub(RceManagementClient.prototype, 'getDevice');
            getDeviceStub.onCall(0).resolves(makeDevice({ status: 'running' }));
            getDeviceStub.onCall(1).resolves(makeDevice({ status: 'running' }));
            sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'running' }));

            await expectThrowsAsync(
                new RceStopDeviceCommand().run({
                    cwd: tempDir,
                    token: 'abc',
                    deviceId: 5,
                    wait: true,
                    waitTimeout: 0
                }),
                `Timed out after 0 seconds waiting for device 5 to reach status 'shutdown' (current status 'running')`
            );
        });

        it('prints the resulting device as a table', async () => {
            (console.log as any).restore();
            let consoleOutput = '';
            sinon.stub(console, 'log').callsFake((...logArgs) => {
                consoleOutput += logArgs.join(' ') + '\n';
            });
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice({ status: 'running' }));
            sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStopDeviceCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(consoleOutput).to.include('my-device');
            expect(consoleOutput).to.include('pending');
        });
        /* eslint-enable camelcase */
    });
});
