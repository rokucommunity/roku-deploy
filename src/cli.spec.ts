import * as childProcess from 'child_process';
import * as path from 'path';
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
import * as http from 'http';
import type { AddressInfo } from 'net';
import { SideloadCommand } from './commands/SideloadCommand';
import { loadCommandOptions } from './commands/commandUtils';

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

    it('applies --logLevel to the logger', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

        const output = execSync(`node ${cwd}/dist/cli.js stage --rootDir ${rootDir} --out ${stagingDir} --logLevel info`).toString();

        expect(output).to.include('Beginning to copy files to staging folder');
    });

    it('applies the config file logLevel to the logger', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { logLevel: 'info' });

        const output = execSync(`node ${cwd}/dist/cli.js stage --rootDir ${rootDir} --out ${stagingDir}`).toString();

        expect(output).to.include('Beginning to copy files to staging folder');
    });

    it('prefers --logLevel over the config file logLevel', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { logLevel: 'info' });

        const output = execSync(`node ${cwd}/dist/cli.js stage --rootDir ${rootDir} --out ${stagingDir} --logLevel error`).toString();

        expect(output).to.not.include('Beginning to copy files to staging folder');
    });

    it('ignores the config file logLevel with --no-config', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');
        fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { logLevel: 'info' });

        const output = execSync(`node ${cwd}/dist/cli.js stage --rootDir ${rootDir} --out ${stagingDir} --no-config`).toString();

        expect(output).to.not.include('Beginning to copy files to staging folder');
    });

    it('Converts to squashfs', async () => {
        const stub = sinon.stub(rokuDeploy, 'convertToSquashfs').callsFake(async () => {
            return Promise.resolve({ rokuMessages: { errors: [], infos: [], successes: [] } });
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
            device: { host: '1.2.3.4' },
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
            device: { host: '1.2.3.4' },
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
            device: { host: '1.2.3.4' },
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
            signingPassword: undefined
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            cwd: cwd,
            device: { host: '1.2.3.4' },
            password: '5536',
            signingPassword: undefined
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
            device: { host: '1.2.3.4' },
            password: '5536'
        });
    });

    it('Deletes an installed channel', async () => {
        const stub = sinon.stub(rokuDeploy, 'deleteDevChannel').callsFake(async () => {
            return Promise.resolve({ rokuMessages: { errors: [], infos: [], successes: [] } });
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
            device: { host: '1.2.3.4' },
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
            device: { host: '1.2.3.4' },
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
            device: { host: '1.2.3.4' },
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
            device: { host: '1.2.3.4' }
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
            device: { host: '1.2.3.4' },
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

    describe('unknown arguments', () => {
        /**
         * Run the cli expecting a non-zero exit, returning its combined output.
         */
        function execExpectingFailure(command: string) {
            try {
                childProcess.execSync(command, { cwd: tempDir, stdio: 'pipe' });
            } catch (e) {
                const error = e as childProcess.SpawnSyncReturns<Buffer>;
                return { status: error.status, output: `${error.stdout}${error.stderr}` };
            }
            throw new Error(`Expected "${command}" to fail`);
        }

        it('fails with a non-zero exit when an option is not recognized', () => {
            const result = execExpectingFailure(`node ${cwd}/dist/cli.js stage --rootdir ${rootDir}`);
            expect(result.status).to.equal(1);
            expect(result.output).to.include('Unknown argument: rootdir');
        });

        it('fails when the command itself is not recognized', () => {
            const result = execExpectingFailure(`node ${cwd}/dist/cli.js deploy`);
            expect(result.status).to.equal(1);
            expect(result.output).to.include('Unknown argument: deploy');
        });

        it('fails for an unknown option on a nested rce command', () => {
            const result = execExpectingFailure(`node ${cwd}/dist/cli.js rce start --bogus`);
            expect(result.status).to.equal(1);
            expect(result.output).to.include('Unknown argument: bogus');
        });

        it('still accepts the --no- negation of a declared boolean option', () => {
            //gets past argument parsing and fails on the missing device instead
            const result = execExpectingFailure(`node ${cwd}/dist/cli.js sideload --no-close --zip app.zip`);
            expect(result.output).not.to.include('Unknown argument');
            expect(result.output).to.include('Missing required option: device');
        });
    });

    describe('CLI flag names that differ from the library options', () => {
        it('maps --host to an inline device config', () => {
            const options = loadCommandOptions({ cwd: tempDir, host: '1.2.3.4', password: 'aaaa' }, null);
            expect(options).to.eql({ cwd: tempDir, device: { host: '1.2.3.4' }, password: 'aaaa' });
        });

        it('maps --host with --no-config too', () => {
            const options = loadCommandOptions({ cwd: tempDir, config: false, host: '1.2.3.4' }, null);
            expect(options.device).to.eql({ host: '1.2.3.4' });
            expect(options).not.to.have.property('host');
        });

        it('lets --host win over the config file device', () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                device: 'office-tv',
                devices: { 'office-tv': { host: '9.9.9.9' } }
            });
            const options = loadCommandOptions({ cwd: tempDir, host: '1.2.3.4' }, null);
            expect(options.device).to.eql({ host: '1.2.3.4' });
        });

        it('leaves the config file device alone when --host is not given', () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { device: { host: '9.9.9.9' } });
            const options = loadCommandOptions({ cwd: tempDir }, null);
            expect(options.device).to.eql({ host: '9.9.9.9' });
        });

        it('maps --esn to an inline RCE device config carrying --rceToken', () => {
            const options = loadCommandOptions({ cwd: tempDir, config: false, esn: 'X123', rceToken: 'abc' }, null);
            expect(options.device).to.eql({ esn: 'X123', rceToken: 'abc' });
            expect(options).not.to.have.property('esn');
        });

        it('maps --instanceUrl to an inline RCE device config carrying --rceToken', () => {
            const options = loadCommandOptions({ cwd: tempDir, config: false, instanceUrl: 'http://1.2.3.4', rceToken: 'abc' }, null);
            expect(options.device).to.eql({ instanceUrl: 'http://1.2.3.4', rceToken: 'abc' });
            expect(options).not.to.have.property('instanceUrl');
        });

        it('falls back to the config file rceToken for an --esn device', () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { rceToken: 'from-config' });
            const options = loadCommandOptions({ cwd: tempDir, esn: 'X123' }, null);
            expect(options.device).to.eql({ esn: 'X123', rceToken: 'from-config' });
        });

        it('leaves the device token off when neither --rceToken nor a config rceToken exists', () => {
            const options = loadCommandOptions({ cwd: tempDir, config: false, esn: 'X123' }, null);
            expect(options.device).to.eql({ esn: 'X123' });
        });

        it('leaves the device token off an --instanceUrl device when no token is available', () => {
            const options = loadCommandOptions({ cwd: tempDir, config: false, instanceUrl: 'http://1.2.3.4' }, null);
            expect(options.device).to.eql({ instanceUrl: 'http://1.2.3.4' });
        });

        it('does not attach --rceToken to a --host device', () => {
            const options = loadCommandOptions({ cwd: tempDir, config: false, host: '1.2.3.4', rceToken: 'abc' }, null);
            expect(options.device).to.eql({ host: '1.2.3.4' });
        });

        it('rejects more than one device address flag at parse time', () => {
            try {
                childProcess.execSync(`node ${cwd}/dist/cli.js getDeviceInfo --host 1.2.3.4 --esn X123`, { cwd: tempDir, stdio: 'pipe' });
            } catch (e) {
                const error = e as childProcess.SpawnSyncReturns<Buffer>;
                expect(error.status).to.equal(1);
                expect(`${error.stderr}`).to.include('Arguments host and esn are mutually exclusive');
                return;
            }
            throw new Error('Expected the command to fail');
        });

        it('accepts the kebab-case spellings --instance-url and --rce-token', () => {
            try {
                //gets past argument parsing and fails on the missing password instead
                childProcess.execSync(`node ${cwd}/dist/cli.js sideload --instance-url http://1.2.3.4 --rce-token abc --zip app.zip --no-config`, { cwd: tempDir, stdio: 'pipe' });
            } catch (e) {
                const error = e as childProcess.SpawnSyncReturns<Buffer>;
                const output = `${error.stdout}${error.stderr}`;
                expect(output).not.to.include('Unknown argument');
                expect(output).to.include('Missing required option: password');
                return;
            }
            throw new Error('Expected the command to fail');
        });

        it('declares the same device options on every device command, so the inlined copies cannot drift', () => {
            //the device flags are inlined per command for readability; guard that they stay identical.
            //each is matched by a description fragment unique to the device block, so the rce start/stop
            //commands' own esn flag (a different option) is not counted here
            const lines = fsExtra.readFileSync(path.join(__dirname, 'cli.ts')).toString().split(/\r?\n/);
            const deviceOptions = [
                { name: 'host', fragment: 'The IP Address of the target Roku' },
                { name: 'esn', fragment: 'Roku Cloud Emulator (RCE) device (instead of --host)' },
                { name: 'instanceUrl', fragment: 'The instance api url of a running RCE device' },
                { name: 'rceToken', fragment: 'The RCE bearer token used with --esn or --instanceUrl' }
            ];
            const declarations = deviceOptions.map(({ name, fragment }) => {
                const matches = lines
                    //strip a trailing `;` so the option that ends a builder chain compares equal to the rest
                    .map(line => line.trim().replace(/;$/, ''))
                    .filter(line => line.startsWith(`.option('${name}', {`) && line.includes(fragment));
                return { name: name, matches: matches };
            });
            for (const { name, matches } of declarations) {
                expect(matches, `device option '${name}' is never declared`).to.not.be.empty;
                //all copies of a given device option are byte-identical (no drift between commands)
                expect([...new Set(matches)], `device option '${name}' is declared inconsistently`).to.have.lengthOf(1);
            }
            //all four device options appear on the same number of commands
            const counts = declarations.map(d => d.matches.length);
            expect([...new Set(counts)], `device options appear on different numbers of commands: ${counts.join(', ')}`).to.have.lengthOf(1);
        });

        it('passes sideload --dir straight through to the library', async () => {
            const stub = sinon.stub(rokuDeploy, 'sideload').resolves({ message: '', rokuMessages: { errors: [], infos: [], successes: [] } });
            await new SideloadCommand().run({ cwd: tempDir, host: '1.2.3.4', password: 'aaaa', dir: rootDir });
            expect(stub.getCall(0).args[0]).to.eql({ cwd: tempDir, device: { host: '1.2.3.4' }, password: 'aaaa', dir: rootDir });
        });

        it('reaches a device from the real CLI with only --host (no config file, nothing stubbed)', async () => {
            const requests: string[] = [];
            const server = http.createServer((req, res) => {
                requests.push(`${req.method} ${req.url}`);
                res.writeHead(200);
                res.end();
            });
            await new Promise<void>(resolve => {
                server.listen(0, '127.0.0.1', resolve);
            });
            const port = (server.address() as AddressInfo).port;
            try {
                //spawn asynchronously: execSync would block this process's event loop and starve the server above
                await new Promise<void>((resolve, reject) => {
                    childProcess.exec(`node ${cwd}/dist/cli.js keyPress --key Home --host 127.0.0.1 --ecpPort ${port} --no-config`, { cwd: tempDir }, (error, stdout, stderr) => {
                        if (error) {
                            reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
                        } else {
                            resolve();
                        }
                    });
                });
            } finally {
                await new Promise<void>(resolve => {
                    server.close(() => resolve());
                });
            }
            expect(requests).to.eql(['POST /keypress/Home']);
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
            expect(options.device).to.eql({ host: '1.2.3.4' });
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

        it('--no-config bypasses the config file entirely', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                password: 'from-root',
                screenshot: { out: './shots' }
            });
            const stub = sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            //yargs turns --no-config into config: false
            await new CaptureScreenshotCommand().run({
                cwd: tempDir,
                config: false,
                host: '1.2.3.4'
            });

            const options = stub.getCall(0).args[0] as any;
            expect(options.password).to.be.undefined;
            expect(options.out).to.be.undefined;
        });

        it('stays silent about the config file when quiet is set', () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { logLevel: 'trace' });
            let consoleOutput = '';
            sinon.stub(console, 'log').callsFake((...logArgs) => {
                consoleOutput += logArgs.join(' ') + '\n';
            });

            const options = loadCommandOptions({ cwd: tempDir }, null, { quiet: true });

            expect(options.logLevel).to.equal('trace');
            expect(consoleOutput).to.not.include('Using config');
        });

        it('announces which config file was loaded', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, { password: 'from-root' });
            let consoleOutput = '';
            sinon.stub(console, 'log').callsFake((...logArgs) => {
                consoleOutput += logArgs.join(' ') + '\n';
            });
            sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            await new CaptureScreenshotCommand().run({
                cwd: tempDir,
                host: '1.2.3.4'
            });

            expect(consoleOutput).to.include(`Using config: ${s`${tempDir}/rokudeploy.json`}`);
        });

        it('stays silent when no config file exists', async () => {
            let consoleOutput = '';
            sinon.stub(console, 'log').callsFake((...logArgs) => {
                consoleOutput += logArgs.join(' ') + '\n';
            });
            sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            await new CaptureScreenshotCommand().run({
                cwd: tempDir,
                host: '1.2.3.4'
            });

            expect(consoleOutput).to.not.include('Using config');
        });

        it('resolves a registry device name from the config file (the CLI has no constructor registry)', async () => {
            fsExtra.outputJsonSync(`${tempDir}/rokudeploy.json`, {
                device: 'office-tv',
                password: 'aaaa',
                devices: {
                    'office-tv': { host: '1.2.3.4' }
                }
            });
            const stub = sinon.stub(rokuDeploy, 'captureScreenshot').resolves({ buffer: Buffer.from(''), format: 'jpg' as const, filePath: '' });

            await new CaptureScreenshotCommand().run({ cwd: tempDir });

            const options = stub.getCall(0).args[0] as any;
            expect(options.device).to.equal('office-tv');
            expect(options.devices['office-tv']).to.eql({ host: '1.2.3.4' });
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
