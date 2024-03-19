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
import { ExecCommand } from './commands/ExecCommand';

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

    it('Successfully bundles an app', () => {
        execSync(`node ${cwd}/dist/cli.js bundle --rootDir ${rootDir} --outDir ${outDir}`);
        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    it('Successfully runs prepublishToStaging', () => {
        //make the files
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

        expect(() => {
            execSync(`node ${cwd}/dist/cli.js prepublishToStaging --stagingDir ${stagingDir} --rootDir ${rootDir}`);
        }).to.not.throw();
    });

    it('Successfully copies rootDir folder to staging folder', () => {
        fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

        execSync(`node ${cwd}/dist/cli.js prepublishToStaging --rootDir ${rootDir} --stagingDir ${stagingDir}`);

        expectPathExists(`${stagingDir}/source/main.brs`);
    });

    it('Successfully uses zipPackage to create .zip', () => {
        fsExtra.outputFileSync(`${stagingDir}/manifest`, '');

        execSync(`node ${cwd}/dist/cli.js zipPackage --stagingDir ${stagingDir} --outDir ${outDir}`);
        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    it('Publish passes proper options', async () => {
        const stub = sinon.stub(rokuDeploy, 'sideload').callsFake(async () => {
            return Promise.resolve({
                message: 'Publish successful',
                results: {}
            });
        });

        const command = new SideloadCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            outDir: outDir,
            outFile: 'rokudeploy-outfile'
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536',
            outDir: outDir,
            outFile: 'rokudeploy-outfile'
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

describe('ExecCommand', () => {
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
    function mockDoPostRequest(body = '', statusCode = 200) {
        return sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params) => {
            let results = { response: { statusCode: statusCode }, body: body };
            rokuDeploy['checkRequest'](results);
            return Promise.resolve(results);
        });
    }

    it('does the whole migration', async () => {
        const mock = mockDoPostRequest();

        const options = {
            host: '1.2.3.4',
            password: 'abcd',
            rootDir: rootDir,
            stagingDir: stagingDir,
            outDir: outDir
        };
        await new ExecCommand('stage|zip|close|sideload', options).run();

        expect(mock.getCall(2).args[0].url).to.equal('http://1.2.3.4:80/plugin_install');
        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    it('continues with deploy if deleteDevChannel fails', async () => {
        sinon.stub(rokuDeploy, 'deleteDevChannel').returns(
            Promise.reject(
                new Error('failed')
            )
        );
        const mock = mockDoPostRequest();
        const options = {
            host: '1.2.3.4',
            password: 'abcd',
            rootDir: rootDir,
            stagingDir: stagingDir,
            outDir: outDir
        };
        await new ExecCommand('stage|zip|close|sideload', options).run();
        expect(mock.getCall(0).args[0].url).to.equal('http://1.2.3.4:8060/keypress/home');
        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    it('should delete installed channel if requested', async () => {
        const spy = sinon.spy(rokuDeploy, 'deleteDevChannel');
        mockDoPostRequest();
        const options = {
            host: '1.2.3.4',
            password: 'abcd',
            rootDir: rootDir,
            stagingDir: stagingDir,
            outDir: outDir,
            deleteDevChannel: true
        };

        await new ExecCommand('stage|zip|close|sideload', options).run();
        expect(spy.called).to.equal(true);
    });

    it('should not delete installed channel if not requested', async () => {
        const spy = sinon.spy(rokuDeploy, 'deleteDevChannel');
        mockDoPostRequest();

        const options = {
            host: '1.2.3.4',
            password: 'abcd',
            rootDir: rootDir,
            stagingDir: stagingDir,
            outDir: outDir,
            deleteDevChannel: false
        };

        await new ExecCommand('stage|zip|close|sideload', options).run();
        expect(spy.notCalled).to.equal(true);
    });

    it('converts to squashfs if we request it to', async () => {
        let stub = sinon.stub(rokuDeploy, 'convertToSquashfs').returns(Promise.resolve<any>(null));
        mockDoPostRequest();
        const options = {
            host: '1.2.3.4',
            password: 'abcd',
            rootDir: rootDir,
            stagingDir: stagingDir,
            outDir: outDir,
            deleteDevChannel: false
        };

        await new ExecCommand('close|stage|zip|close|sideload|squash', options).run();
        expect(stub.getCalls()).to.be.lengthOf(1);
    });
});
