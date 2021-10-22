import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as rokuDeploy from './index';
import { expectPathExists, expectThrowsAsync, rootDir } from './testUtils.spec';

//these tests are run against an actual roku device. These cannot be enabled when run on the CI server
describe('device', function device() {
    let options: rokuDeploy.RokuDeployOptions;
    let originalCwd = process.cwd();

    beforeEach(() => {
        options = rokuDeploy.getOptions();
        options.rootDir = './testProject';
        fsExtra.outputFileSync(`${rootDir}/roku-deploy.json`, `{
            "password": "password",
            "host": "192.168.1.103",
            "rootDir": "testProject",
            "devId": "c6fdc2019903ac3332f624b0b2c2fe2c733c3e74",
            "rekeySignedPackage": "../testSignedPackage.pkg",
            "signingPassword": "drRCEVWP/++K5TYnTtuAfQ=="
        }`);
    });

    afterEach(() => {
        //restore the original working directory
        process.chdir(originalCwd);

        //delete the output file and other interum files
        let filePaths = [
            path.resolve(options.outDir),
            '.tmp'
        ];
        for (let filePath of filePaths) {
            try {
                fsExtra.removeSync(filePath);
            } catch (e) { }
        }
    });

    this.timeout(20000);

    describe('deploy', () => {
        it('works', async () => {
            let response = await rokuDeploy.deploy(options);
            assert.equal(response.message, 'Successful deploy');
        });

        it('Presents nice message for 401 unauthorized status code', async () => {
            options.password = 'NOT_THE_PASSWORD';
            await expectThrowsAsync(
                rokuDeploy.deploy(options),
                'Unauthorized. Please verify username and password for target Roku.'
            );
        });
    });

    describe('deployAndSignPackage', () => {
        it('works', async () => {
            expectPathExists(
                await rokuDeploy.deployAndSignPackage(options)
            );
        });
    });
});
