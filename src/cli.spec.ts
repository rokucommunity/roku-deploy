import * as childProcess from 'child_process';
import { cwd, expectPathExists, rootDir, stagingDir, tempDir, outDir } from './testUtils.spec';
import * as fsExtra from 'fs-extra';
import { expect } from 'chai';
import * as path from 'path';
import { createSandbox } from 'sinon';
import { rokuDeploy } from './index';
import { PublishCommand } from './commands/PublishCommand';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { SignExistingPackageCommand } from './commands/SignExistingPackageCommand';
import { DeployCommand } from './commands/DeployCommand';
import { DeleteInstalledChannelCommand } from './commands/DeleteInstalledChannelCommand';
import { TakeScreenshotCommand } from './commands/TakeScreenshotCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';
import { RetrieveSignedPackageCommand } from './commands/RetrieveSignedPackageCommand';

const sinon = createSandbox();

function execSync(command: string) {
    const output = childProcess.execSync(command, { cwd: tempDir });
    process.stdout.write(output);
    return output;
    // return childProcess.execSync(command, { stdio: 'inherit', cwd: tempDir });
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
    });
    afterEach(() => {
        fsExtra.removeSync(tempDir);
    });

    it('Successfully runs prepublishToStaging', () => {
        //make the files
        // fsExtra.outputFileSync(`${rootDir}/manifest`, '');
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

    it('Successfully uses createPackage to create .pkg', () => {
        execSync(`node ${cwd}/dist/cli.js createPackage --stagingDir ${stagingDir} --rootDir ${rootDir} --outDir ${outDir}`);
        expectPathExists(`${outDir}/roku-deploy.zip`);
    });

    it('Publish passes proper options', async () => {
        const stub = sinon.stub(rokuDeploy, 'publish').callsFake(async () => {
            return Promise.resolve({
                message: 'Publish successful',
                results: {}
            });
        });

        const command = new PublishCommand();
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
        const stub = sinon.stub(rokuDeploy, 'signExistingPackage').callsFake(async () => {
            return Promise.resolve('');
        });

        const command = new SignExistingPackageCommand();
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

    it('Retrieves a signed package', async () => {
        const stub = sinon.stub(rokuDeploy, 'retrieveSignedPackage').callsFake(async () => {
            return Promise.resolve('');
        });

        const command = new RetrieveSignedPackageCommand();
        await command.run({
            pathToPkg: 'path_to_pkg',
            host: '1.2.3.4',
            password: '5536',
            outFile: 'roku-deploy-test'
        });
        console.log(stub.getCall(0).args[0]);

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            pathToPkg: 'path_to_pkg',
            host: '1.2.3.4',
            password: '5536',
            outFile: 'roku-deploy-test'
        });//TODO: fix!
    });

    it('Deploys a package', async () => {
        const stub = sinon.stub(rokuDeploy, 'deploy').callsFake(async () => {
            return Promise.resolve({
                message: 'Convert successful',
                results: {}
            });
        });

        const command = new DeployCommand();
        await command.run({
            host: '1.2.3.4',
            password: '5536',
            rootDir: rootDir
        });

        expect(
            stub.getCall(0).args[0]
        ).to.eql({
            host: '1.2.3.4',
            password: '5536',
            rootDir: rootDir
        });
    });

    it('Deletes an installed channel', async () => {
        const stub = sinon.stub(rokuDeploy, 'deleteInstalledChannel').callsFake(async () => {
            return Promise.resolve({ response: {}, body: {} });
        });

        const command = new DeleteInstalledChannelCommand();
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
        const stub = sinon.stub(rokuDeploy, 'takeScreenshot').callsFake(async () => {
            return Promise.resolve('');
        });

        const command = new TakeScreenshotCommand();
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

    it('Gets output zip file path', () => {
        let zipFilePath = execSync(`node ${cwd}/dist/cli.js getOutputZipFilePath --outFile "roku-deploy" --outDir ${outDir}`).toString();

        expect(zipFilePath.trim()).to.equal(path.join(path.resolve(outDir), 'roku-deploy.zip'));
    });

    it('Gets output pkg file path', () => {
        let pkgFilePath = execSync(`node ${cwd}/dist/cli.js getOutputPkgFilePath --outFile "roku-deploy" --outDir ${outDir}`).toString();

        expect(pkgFilePath.trim()).to.equal(path.join(path.resolve(outDir), 'roku-deploy.pkg'));
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
            consoleOutput += args.join(' ') + '\n'; //TODO: I don't think this is accurately adding a new line
        });
        sinon.stub(rokuDeploy, 'getDeviceInfo').returns(Promise.resolve({
            'device-id': '1234',
            'serial-number': 'abcd'
        }));
        await new GetDeviceInfoCommand().run({
            host: '1.2.3.4'
        });
        expect(consoleOutput.trim()).to.eql(
            '{"device-id":"1234","serial-number":"abcd"}'
        );
    }); //TODO: This passes when it is it.only, but fails in the larger test suite?

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
            host: '1.2.3.4'
        });
    });

    it('Zips a folder', () => {
        execSync(`node ${cwd}/dist/cli.js zipFolder --srcFolder ${rootDir} --zipFilePath "roku-deploy.zip"`);

        expectPathExists(`${tempDir}/roku-deploy.zip`);
    });
});
