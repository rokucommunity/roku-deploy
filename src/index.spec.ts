import * as  assert from 'assert';
import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as Q from 'q';
import * as AdmZip from 'adm-zip';
import * as nrc from 'node-run-cmd';
import * as td from 'testdouble';

import { createPackage, deploy, getOptions, publish, prepublishToStaging, zipPackage, RokuDeployOptions, __request, pressHomeButton } from './index';
import * as rokuDeploy from './index';

function getOutputFilePath() {
    return path.join(<string>options.outDir, <string>options.outFile);
}
let options: RokuDeployOptions;

beforeEach(() => {
    options = getOptions();
    options.rootDir = './testProject';
});
afterEach(() => {
    //delete the output file and other interum files
    let filePaths = [
        getOutputFilePath(),
        path.dirname(getOutputFilePath()),
        '.tmp'
    ];
    for (let filePath of filePaths) {
        try {
            fsExtra.removeSync(filePath);
        } catch (e) { }
    }
});

//these tests are run against an actual roku device. These cannot be enabled when run on the CI server
describe.skip('deploy against actual Roku device', () => {
    it('works', async function () {
        this.timeout(20000);
        options.password = 'password';
        options.host = '192.168.1.17';
        let response = await deploy(options);
        assert.equal(response.message, 'Successful deploy');
    });

    it('Presents nice message for 401 unauthorized status code', async function () {
        this.timeout(20000);
        options.password = 'NOT_THE_PASSWORD';
        options.host = '192.168.1.17';
        try {
            let response = await deploy(options);
            assert.fail('Should have rejected');
        } catch (e) {
            assert.equal(e.message, 'Unauthorized. Please verify username and password for target Roku.');
        }
    });
});

describe('createPackage', function () {

    it('should throw error when no files were found to copy', async () => {
        try {
            options.files = [];
            await createPackage(options);
            assert.fail('Exception should have been thrown');
        } catch (e) {
            assert.ok('Exception was thrown as expected');
        }
    });

    it('should create package in proper directory', async function () {
        await createPackage(options);
        let exists = fsExtra.existsSync(getOutputFilePath());
        assert.equal(exists, true);
    });

    it('should only include the specified files', async () => {
        try {
            options.files = ['manifest'];
            await createPackage(options);
            let zip = new AdmZip(getOutputFilePath());
            await fsExtra.ensureDir('.tmp');
            zip.extractAllTo('.tmp/output', true);
            assert.equal(fsExtra.existsSync('./.tmp/output/manifest'), true);
        } catch (e) {
            throw e;
        }
    });

    it('generates full package with defaults', async () => {
        await createPackage(options);
        let zip = new AdmZip(getOutputFilePath());
        await fsExtra.ensureDir('.tmp');
        zip.extractAllTo('.tmp/output', true);
        assert.equal(fsExtra.existsSync('./.tmp/output/components'), true);
        assert.equal(fsExtra.existsSync('./.tmp/output/images'), true);
        assert.equal(fsExtra.existsSync('./.tmp/output/source'), true);
    });

    it('fails with good error message when unable to find manifest', async () => {
        //wipe out the files array
        options.files = [];
        try {
            await createPackage(options);
            assert.fail('Should have thrown exception');
        } catch (e) {
            assert.equal(e.message, 'Unable to find manifest file');
            assert.ok('Threw exception as expected');
        }
    });

    it('should retain the staging directory when told to', async () => {
        let stagingFolderPath = await prepublishToStaging(options);
        assert.equal(fsExtra.existsSync(stagingFolderPath), true);
        options.retainStagingFolder = true;
        await zipPackage(options);
        assert.equal(fsExtra.existsSync(stagingFolderPath), true);
    });
});

it('runs via the command line using the brsconfig.json file', function (done) {
    this.timeout(20000);
    nrc.run('node dist/index.js', {
        onData: function (data) {
        }
    }).then(() => {
        assert.ok('deploy succeeded');
        done();
    }, () => {
        assert.fail('deploy failed');
        done();
    });
});

describe('press home button', () => {
    it('rejects promise on error', () => {
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            callback(new Error());
        };
        return pressHomeButton({}).then(() => {
            assert.fail('Should have rejected the promise');
        }, () => {
            expect(true).to.be.true;
        });
    });
});

let fileCounter = 1;
describe('publish', () => {
    beforeEach(() => {
        options.host = '0.0.0.0';
        //rename the rokudeploy.json file so publish doesn't pick it up
        try { fsExtra.renameSync('rokudeploy.json', 'temp.rokudeploy.json'); } catch (e) { }

        //make a dummy output file...we don't care what's in it
        options.outFile = `temp${fileCounter++}.zip`;
        try { fsExtra.mkdirSync(options.outDir); } catch (e) { }
        try { fsExtra.appendFileSync(`${options.outDir}/${options.outFile}`, 'asdf'); } catch (e) { }
    });

    afterEach(() => {
        //rename the rokudeploy.json file so publish doesn't pick it up
        try { fsExtra.renameSync('temp.rokudeploy.json', 'rokudeploy.json'); } catch (e) { }
    });
    it('fails when no host is provided', () => {
        expect(fsExtra.existsSync('rokudeploy.json')).to.be.false;
        return publish({ host: undefined }).then(() => {
            assert.fail('Should not have succeeded');
        }, () => {
            expect(true).to.be.true;
        });
    });

    it('rejects when package upload fails', () => {
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            if (data.url === `http://${options.host}/plugin_install`) {
                process.nextTick(() => {
                    callback(new Error('Failed to publish to server'));
                });
            } else {
                process.nextTick(callback);
            }
            return {
                auth: () => { }
            };
        };

        return publish(options).then(() => {
            expect(true, 'Should not have succeeded').to.be.false;
            return Promise.reject('Should not have succeeded');
        }).then(() => {
            assert.fail('Should not have succeeded');
        }, () => {
            expect(true).to.be.true;
        });
        // expect(true).to.be.true;
    });

    it('rejects when response contains compile error wording', () => {
        options.failOnCompileError = true;
        let body = 'Install Failure: Compilation Failed.';
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            process.nextTick(callback, undefined, {}, body);
            return {
                auth: () => { }
            };
        };

        return publish(options).then(() => {
            assert.fail('Should not have succeeded due to roku server compilation failure');
        }, (err) => {
            expect(err.message).to.equal('Compile error');
            expect(true).to.be.true;
        });
    });

    it('rejects when response contains invalid password status code', () => {
        options.failOnCompileError = true;
        let body = '';
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            process.nextTick(callback, undefined, { statusCode: 401 }, body);
            return {
                auth: () => { }
            };
        };

        return publish(options).then(() => {
            assert.fail('Should not have succeeded due to roku server compilation failure');
        }, (err) => {
            expect(err.message).to.equal('Unauthorized. Please verify username and password for target Roku.');
            expect(true).to.be.true;
        });
    });

    it('handles successful deploy', () => {
        options.failOnCompileError = true;
        let body = '';
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            process.nextTick(callback, undefined, { statusCode: 200 }, body);
            return {
                auth: () => { }
            };
        };

        return publish(options).then((result) => {
            expect(result.message).to.equal('Successful deploy');
        }, (err) => {
            assert.fail('Should not have rejected the promise');
        });
    });

    it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', () => {
        options.failOnCompileError = false;

        let body = 'Identical to previous version -- not replacing.';
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            process.nextTick(callback, undefined, { statusCode: 200 }, body);
            return {
                auth: () => { }
            };
        };

        return publish(options).then((result) => {
            expect(result.results.body).to.equal(body);
        }, (err) => {
            assert.fail('Should have resolved promise');
        });
    });

    it('rejects when response is unknown error code', () => {
        options.failOnCompileError = true;
        let body = 'Identical to previous version -- not replacing.';
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            process.nextTick(callback, undefined, { statusCode: 123 }, body);
            return {
                auth: () => { }
            };
        };

        return publish(options).then((result) => {
            expect(result.results.body).to.equal(body);
            assert.fail('Should have rejected promise');
        }, (err) => {
            expect(true).to.be.true;
        });
    });

    it('rejects when encountering an undefined response', () => {
        options.failOnCompileError = true;
        let body = 'Identical to previous version -- not replacing.';
        //intercept the post requests
        (__request as any).post = function (data, callback) {
            process.nextTick(callback, undefined, undefined, body);
            return {
                auth: () => { }
            };
        };

        return publish(options).then((result) => {
            expect(result.results.body).to.equal(body);
            assert.fail('Should have rejected promise');
        }, (err) => {
            expect(err.message).to.equal('Invalid response');
        });
    });

});

describe('prepublishToStaging', () => {
    it('should use outDir for staging folder', async () => {
        await prepublishToStaging(options);
        expect(fsExtra.existsSync('out/.roku-deploy-staging')).to.be.true;
    });
});

describe('deploy', () => {
    it('does the whole migration', async () => {
        //
        (__request as any).post = function (data, callback) {
            if (typeof data === 'string' && data.indexOf('keypress/Home') > -1) {
                process.nextTick(callback);
            } else {
                process.nextTick(callback, undefined, { statusCode: 200 }, '');
            }
            return {
                auth: () => { }
            };
        };

        let result = await rokuDeploy.deploy();
        expect(result).not.to.be.undefined;
    });
});
