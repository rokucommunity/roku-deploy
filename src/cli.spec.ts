import * as childProcess from 'child_process';
import { cwd, expectPathExists, rootDir, stagingDir, tempDir, outDir } from './testUtils.spec';
import * as fsExtra from 'fs-extra';
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { rokuDeploy } from './index';
import { SideloadCommand } from './commands/SideloadCommand';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { CreateSignedPackageCommand } from './commands/CreateSignedPackageCommand';
import { DeleteDevChannelCommand } from './commands/DeleteDevChannelCommand';
import { CaptureScreenshotCommand } from './commands/CaptureScreenshotCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';

const sinon = createSandbox();

function execSync(command: string) {
    const output = childProcess.execSync(command, { cwd: tempDir });
    process.stdout.write(output);
    return output;
}
describe('cli', () => {
    before(function build() {
        this.timeout(20000);
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
            execSync(`node ${cwd}/dist/cli.js stage --stagingDir ${stagingDir} --rootDir ${rootDir}`);
        }).to.not.throw();
    });

    it('Successfully copies rootDir folder to staging folder', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

        execSync(`node ${cwd}/dist/cli.js stage --rootDir ${rootDir} --stagingDir ${stagingDir}`);

        expectPathExists(`${stagingDir}/source/main.brs`);
    });

    it('SideloadCommand passes proper options when zip is provided', async () => {
        sinon.stub(rokuDeploy, 'closeChannel').callsFake(async () => {
            return Promise.resolve();
        });
        const sideloadStub = sinon.stub(rokuDeploy, 'sideload').callsFake(async () => {
            return Promise.resolve({
                message: 'Successful sideload',
                results: {}
            });
        });

        const command = new SideloadCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            zip: 'test.zip'
        });

        expect(
            sideloadStub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536',
            outDir: cwd,
            outFile: 'test.zip',
            zip: 'test.zip',
            retainDeploymentArchive: true
        });
    });

    it('SideloadCommand passes proper options when rootDir is provided', async () => {
        sinon.stub(rokuDeploy, 'closeChannel').callsFake(async () => {
            return Promise.resolve();
        });
        sinon.stub(rokuDeploy, 'zip').callsFake(async () => {
            return Promise.resolve();
        });
        const sideloadStub = sinon.stub(rokuDeploy, 'sideload').callsFake(async () => {
            return Promise.resolve({
                message: 'Successful sideload',
                results: {}
            });
        });

        const command = new SideloadCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            rootDir: rootDir
        });

        expect(
            sideloadStub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536',
            rootDir: rootDir,
            retainDeploymentArchive: false
        });
    });

    it('SideloadCommand throws error when neither zip nor rootDir is provided', async () => {
        const command = new SideloadCommand();
        
        try {
            await command.run({
                host: '1.2.3.4',
                password: '5536',
                noclose: true
            });
            expect.fail('Expected an error to be thrown');
        } catch (error) {
            expect((error as Error).message).to.equal('Either zip or rootDir must be provided for sideload command');
        }
    });

    it('SideloadCommand calls the proper methods when noclose is provided', async () => {
        const closeChannelStub = sinon.stub(rokuDeploy, 'closeChannel').callsFake(async () => {
            return Promise.resolve();
        });
        const sideloadStub = sinon.stub(rokuDeploy, 'sideload').callsFake(async () => {
            return Promise.resolve({
                message: 'Successful sideload',
                results: {}
            });
        });

        const command = new SideloadCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            zip: 'test.zip',
            noclose: true
        });

        expect(closeChannelStub.callCount).to.equal(0);

        expect(
            sideloadStub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536',
            noclose: true,
            outDir: cwd,
            outFile: 'test.zip',
            retainDeploymentArchive: true,
            zip: 'test.zip'
        });
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
            rekeySignedPackage: `${tempDir}/testSignedPackage.pkg`,
            signingPassword: '12345',
            rootDir: rootDir,
            devId: 'abcde'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536',
            rekeySignedPackage: `${tempDir}/testSignedPackage.pkg`,
            signingPassword: '12345',
            rootDir: rootDir,
            devId: 'abcde'
        });
    });

    it('Signs an existing package', async () => {
        const stub = sinon.stub(rokuDeploy, 'createSignedPackage').callsFake(async () => {
            return Promise.resolve('');
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
            host: '1.2.3.4',
            password: '5536',
            signingPassword: undefined,
            stagingDir: stagingDir
        });
    });

    it('Deletes an installed channel', async () => {
        const stub = sinon.stub(rokuDeploy, 'deleteDevChannel').callsFake(async () => {
            return Promise.resolve({ response: {}, body: {} });
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
            return Promise.resolve('');
        });

        const command = new CaptureScreenshotCommand();
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
            return Promise.resolve('');
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
        execSync(`node ${cwd}/dist/cli.js zip --stagingDir ${rootDir} --outDir ${outDir}`);

        expectPathExists(`${outDir}/roku-deploy.zip`);
    });
});
