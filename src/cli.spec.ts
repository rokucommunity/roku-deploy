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
import { RceStartCommand } from './commands/RceStartCommand';
import { RceStopCommand } from './commands/RceStopCommand';
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
            cwd: cwd,
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
            cwd: cwd,
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
            cwd: cwd,
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
            cwd: cwd,
            host: '1.2.3.4',
            password: '5536'
        });
    });

    it('Zips a folder', () => {
        execSync(`node ${cwd}/dist/cli.js zip --dir ${rootDir} --out ${outDir}/roku-deploy.zip`);

        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    describe('rce', () => {
        function makeDevice(overrides?: Partial<RceDevice>): RceDevice {
            return {
                id: 5,
                name: 'my-device',
                deviceType: 'tv',
                status: 'shutdown',
                createdAt: '2026-01-01',
                lastSnapshotId: 11,
                firmwareVersionId: 'fw-device',
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

            await new RceStartCommand().run({
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
                    snapshotId: 99,
                    firmwareVersionId: 'fw-1',
                    maxRuntime: 120
                }
            });
            //explicit snapshot and firmware means no snapshot lookup was needed
            expect(listSnapshotsStub.called).to.be.false;
        });

        it('defaults the snapshot to the live one and the firmware to that snapshot\'s', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 10, live: false, base: false, createdAt: '2026-01-01', firmwareVersionId: 'fw-old' },
                { id: 12, live: true, base: false, createdAt: '2026-01-02', firmwareVersionId: 'fw-live' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(startStub.getCall(0).args[0]).to.eql({
                deviceId: 5,
                start: {
                    snapshotId: 12,
                    firmwareVersionId: 'fw-live',
                    maxRuntime: 3600
                }
            });
        });

        it('falls back to the device firmware, then the first for the device type', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(
                makeDevice({ firmwareVersionId: null })
            );
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, createdAt: '2026-01-02' }
            ]);
            sinon.stub(RceManagementClient.prototype, 'listFirmwareVersions').resolves([
                { firmwareVersionId: 'fw-stb', deviceType: 'stb' },
                { firmwareVersionId: 'fw-tv', deviceType: 'tv' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(startStub.getCall(0).args[0].start.firmwareVersionId).to.equal('fw-tv');
        });

        it('throws when no snapshot is live (never falls back to the last-loaded snapshot)', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            //the device HAS a last-loaded snapshot, but booting it would revert the live state
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 11, live: false, base: false, createdAt: '2026-01-01' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await expectThrowsAsync(
                new RceStartCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5 }),
                `Device 'my-device' has no live snapshot; pass --snapshot or --snapshotId to pick one`
            );
            expect(startStub.called).to.be.false;
        });

        it('resolves --snapshot by name', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 10, live: false, base: false, createdAt: '2026-01-01', name: 'alpha', firmwareVersionId: 'fw-alpha' },
                { id: 12, live: true, base: false, createdAt: '2026-01-02', name: 'beta', firmwareVersionId: 'fw-live' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshot: 'alpha'
            });

            expect(startStub.getCall(0).args[0].start).to.eql({
                snapshotId: 10,
                firmwareVersionId: 'fw-alpha',
                maxRuntime: 3600
            });
        });

        it(`resolves --snapshot 'live' to the live snapshot even when another snapshot is named 'live'`, async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 10, live: false, base: false, createdAt: '2026-01-01', name: 'live', firmwareVersionId: 'fw-old' },
                { id: 12, live: true, base: false, createdAt: '2026-01-02', firmwareVersionId: 'fw-live' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshot: 'live'
            });

            expect(startStub.getCall(0).args[0].start.snapshotId).to.equal(12);
        });

        it('throws when --snapshot matches no snapshot name', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, createdAt: '2026-01-02', name: 'beta' }
            ]);

            await expectThrowsAsync(
                new RceStartCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5, snapshot: 'nope' }),
                `Device 'my-device' has no snapshot named 'nope'`
            );
        });

        it('throws when --snapshot matches multiple snapshots', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 10, live: false, base: false, createdAt: '2026-01-01', name: 'twin' },
                { id: 12, live: true, base: false, createdAt: '2026-01-02', name: 'twin' }
            ]);

            await expectThrowsAsync(
                new RceStartCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5, snapshot: 'twin' }),
                `Device 'my-device' has 2 snapshots named 'twin'; pass --snapshotId to pick one`
            );
        });

        it('looks up snapshots for the firmware when only the snapshotId is explicit', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            const listSnapshotsStub = sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, createdAt: '2026-01-02', firmwareVersionId: 'fw-snap' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshotId: 12
            });

            expect(listSnapshotsStub.callCount).to.equal(1);
            expect(startStub.getCall(0).args[0].start.firmwareVersionId).to.equal('fw-snap');
        });

        it('uses the device firmware when the explicit snapshotId is not in the snapshot list', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, createdAt: '2026-01-02', firmwareVersionId: 'fw-snap' }
            ]);
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5,
                snapshotId: 99
            });

            expect(startStub.getCall(0).args[0].start.firmwareVersionId).to.equal('fw-device');
        });

        it('throws when no firmware version is available for the device type', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(
                makeDevice({ firmwareVersionId: null })
            );
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([
                { id: 12, live: true, base: false, createdAt: '2026-01-02' }
            ]);
            sinon.stub(RceManagementClient.prototype, 'listFirmwareVersions').resolves([
                { firmwareVersionId: 'fw-stb', deviceType: 'stb' }
            ]);

            await expectThrowsAsync(
                new RceStartCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5 }),
                `No firmware version is available for device type 'tv'`
            );
        });

        it('resolves the device by esn', async () => {
            sinon.stub(RceManagementClient.prototype, 'listDevices').resolves([
                makeDevice({ id: 4, serialNumber: 'X001' }),
                makeDevice({ id: 5, serialNumber: 'X123' })
            ]);
            const stopStub = sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStopCommand().run({
                cwd: tempDir,
                token: 'abc',
                esn: 'X123'
            });

            expect(stopStub.getCall(0).args[0]).to.eql({ deviceId: 5 });
        });

        it('throws when no token is available', async () => {
            await expectThrowsAsync(
                new RceStartCommand().run({ cwd: tempDir, deviceId: 5 }),
                'An RCE token is required. Pass --token or set "rceToken" in rokudeploy.json'
            );
        });

        it('reads the token from rokudeploy.json', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { rceToken: 'from-config' });
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice({ status: 'running' }));
            const stopStub = sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStopCommand().run({
                cwd: tempDir,
                deviceId: 5
            });

            expect(stopStub.called).to.be.true;
        });

        it('throws when neither deviceId nor esn is provided', async () => {
            await expectThrowsAsync(
                new RceStopCommand().run({ cwd: tempDir, token: 'abc' }),
                'A device is required. Pass --deviceId, --esn, or --device'
            );
        });

        it('throws when the esn matches no device', async () => {
            sinon.stub(RceManagementClient.prototype, 'listDevices').resolves([]);

            await expectThrowsAsync(
                new RceStopCommand().run({ cwd: tempDir, token: 'abc', esn: 'X999' }),
                `No RCE device found with esn 'X999'`
            );
        });

        it('throws when the device has no snapshots at all', async () => {
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(
                makeDevice({ lastSnapshotId: null })
            );
            sinon.stub(RceManagementClient.prototype, 'listSnapshots').resolves([]);

            await expectThrowsAsync(
                new RceStartCommand().run({ cwd: tempDir, token: 'abc', deviceId: 5 }),
                `Device 'my-device' has no live snapshot; pass --snapshot or --snapshotId to pick one`
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
                runningDevice: {
                    id: 1,
                    creatorId: 'user-1',
                    createdAt: '2026-01-03',
                    snapshotId: 11,
                    instanceUuid: 'uuid-1',
                    firmwareVersionId: 'fw-device',
                    maxRuntime: 3600,
                    instanceApiUrl: 'https://instance.example.com'
                }
            }));
            sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
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

            await new RceStopCommand().run({
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
                new RceStartCommand().run({
                    cwd: tempDir,
                    token: 'abc',
                    deviceId: 5,
                    snapshotId: 11,
                    firmwareVersionId: 'fw-device',
                    wait: true,
                    timeout: 0
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
                new RceStopCommand().run({
                    cwd: tempDir,
                    token: 'abc',
                    deviceId: 5,
                    wait: true,
                    timeout: 0
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

            await new RceStopCommand().run({
                cwd: tempDir,
                token: 'abc',
                deviceId: 5
            });

            expect(consoleOutput).to.include('my-device');
            expect(consoleOutput).to.include('pending');
        });

        it('resolves the device from a --device registry name and takes the token from its entry', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                devices: {
                    emu: { esn: 'X123', rceToken: 'entry-token' }
                }
            });
            const findStub = sinon.stub(RceManagementClient.prototype, 'findDeviceByEsn').resolves(makeDevice({ id: 5 }));
            const stopStub = sinon.stub(RceManagementClient.prototype, 'stopDevice').resolves(makeDevice({ status: 'pending' }));

            //no --token and no root rceToken: the registry entry's rceToken is the only token available
            await new RceStopCommand().run({
                cwd: tempDir,
                device: 'emu'
            });

            expect(findStub.getCall(0).args[0]).to.eql({ esn: 'X123' });
            expect(stopStub.getCall(0).args[0]).to.eql({ deviceId: 5 });
        });

        it('throws when the --device registry name is unknown', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                rceToken: 'root-token',
                devices: { emu: { esn: 'X123' } }
            });
            await expectThrowsAsync(
                new RceStopCommand().run({ cwd: tempDir, device: 'nope' }),
                `Device 'nope' was not found in the devices registry`
            );
        });

        it('throws for a --device name when no devices registry exists at all', async () => {
            await expectThrowsAsync(
                new RceStopCommand().run({ cwd: tempDir, token: 'abc', device: 'nope' }),
                `Device 'nope' was not found in the devices registry`
            );
        });

        it('throws for an inline root device config without an id or esn', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                rceToken: 'root-token',
                device: { host: '1.2.3.4' }
            });
            await expectThrowsAsync(
                new RceStopCommand().run({ cwd: tempDir }),
                `Device '{"host":"1.2.3.4"}' is not an RCE device (needs an 'id' or 'esn')`
            );
        });

        it('throws when the --device registry entry has no id or esn', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                rceToken: 'root-token',
                devices: { tv: { host: '1.2.3.4' } }
            });
            await expectThrowsAsync(
                new RceStopCommand().run({ cwd: tempDir, device: 'tv' }),
                `Device 'tv' is not an RCE device (needs an 'id' or 'esn')`
            );
        });

        it('applies rce.start section values that yargs used to clobber with defaults', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                rceToken: 'root-token',
                'rce.start': { maxRuntime: 120 }
            });
            sinon.stub(RceManagementClient.prototype, 'getDevice').resolves(makeDevice());
            const startStub = sinon.stub(RceManagementClient.prototype, 'startDevice').resolves(makeDevice({ status: 'pending' }));

            await new RceStartCommand().run({
                cwd: tempDir,
                deviceId: 5,
                snapshotId: 11,
                firmwareVersionId: 'fw-1'
            });

            expect(startStub.getCall(0).args[0].start.maxRuntime).to.equal(120);
        });
    });

    describe('config file integration', () => {
        it('merges root values and the command section under CLI args', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                password: 'from-root',
                screenshot: { out: './shots' }
            });
            const stub = sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            await new CaptureScreenshotCommand().run({
                cwd: tempDir,
                host: '1.2.3.4'
            });

            const options = stub.getCall(0).args[0] as any;
            expect(options.password).to.equal('from-root');
            expect(options.out).to.equal('./shots');
            expect(options.host).to.equal('1.2.3.4');
        });

        it('CLI args win over the command section', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                password: 'from-root',
                screenshot: { out: './shots' }
            });
            const stub = sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            await new CaptureScreenshotCommand().run({
                cwd: tempDir,
                host: '1.2.3.4',
                out: './cli-wins'
            });

            expect((stub.getCall(0).args[0] as any).out).to.equal('./cli-wins');
        });

        it('loads the file named by --config instead of cwd/rokudeploy.json', async () => {
            fsExtra.outputJsonSync(`${tempDir}/elsewhere/deploy-config.json`, {
                password: 'from-custom'
            });
            const stub = sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            await new CaptureScreenshotCommand().run({
                cwd: tempDir,
                config: `${tempDir}/elsewhere/deploy-config.json`,
                host: '1.2.3.4'
            });

            expect((stub.getCall(0).args[0] as any).password).to.equal('from-custom');
        });
    });
});
