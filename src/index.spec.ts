import * as  assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as Q from 'q';
import * as AdmZip from 'adm-zip';
import * as nrc from 'node-run-cmd';

import { createPackage, deploy, getOptions, RokuDeployOptions } from './index';

let outputFilePath: string;
let options: RokuDeployOptions;

beforeEach(() => {
    options = getOptions();
    options.rootDir = './testProject';
    outputFilePath = path.join(<string>options.outDir, <string>options.outFile);
});
afterEach(async () => {
    //delete the output file and other interum files
    try { await Q.nfcall(fsExtra.remove, path.dirname(outputFilePath)); } catch (e) { }
    try { await Q.nfcall(fsExtra.remove, '.tmp'); } catch (e) { }
});

describe('createPackage', function () {

    it('should create package in proper directory', async function () {
        await createPackage(options);
        let exists = fsExtra.existsSync(outputFilePath);
        assert.equal(exists, true);
    });

    it('should only include the specified files', async () => {
        try {
            options.files = ['manifest'];
            await createPackage(options);
            var zip = new AdmZip(outputFilePath);
            await fsExtra.ensureDir('.tmp');
            zip.extractAllTo('.tmp/output', true);
            assert.equal(fsExtra.existsSync('./.tmp/output/manifest'), true);
        } catch (e) {
            throw e;
        }
    });

    it('generates full package with defaults', async () => {
        await createPackage(options);
        var zip = new AdmZip(outputFilePath);
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
});

describe('deploy', () => {
    it('works', async function () {
        this.timeout(20000);
        options.password = 'password';
        options.host = '192.168.1.17';
        let response = await deploy(options);
        assert.equal(response.message, 'Successful deploy');
    });
});

it('runs via the command line using the brsconfig.json file', function (done) {
    this.timeout(20000);
    nrc.run('node dist/index.js', {
        onData: function (data) {
            console.log(data);
        }
    }).then(() => {
        assert.ok('deploy succeeded');
        done();
    }, () => {
        assert.fail('deploy failed');
        done();
    });
});