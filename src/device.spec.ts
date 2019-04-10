import * as assert from 'assert';
import * as chai from 'chai';
import * as chaiFiles from 'chai-files';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

import * as rokuDeploy from './index';

chai.use(chaiFiles);

const expect = chai.expect;
const file = chaiFiles.file;

//these tests are run against an actual roku device. These cannot be enabled when run on the CI server
describe('device', function () {
    let options: rokuDeploy.RokuDeployOptions;
    let originalCwd = process.cwd();

    beforeEach(() => {
        options = rokuDeploy.getOptions();
        options.rootDir = './testProject';

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

    describe('deploy', function () {
        it('works', async function () {
            let response = await rokuDeploy.deploy(options);
            assert.equal(response.message, 'Successful deploy');
        });

        it('Presents nice message for 401 unauthorized status code', async function () {
            options.password = 'NOT_THE_PASSWORD';
            try {
                let response = await rokuDeploy.deploy(options);
            } catch (e) {
                assert.equal(e.message, 'Unauthorized. Please verify username and password for target Roku.');
                return;
            }
            assert.fail('Should have rejected');
        });
    });

    describe('deployAndSignPackage', () => {
        it('works', async function () {
            expect(file(await rokuDeploy.deployAndSignPackage(options))).to.exist;
        });
    });
});
