import * as  assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as Q from 'q';
import * as AdmZip from 'adm-zip';

import { createPackage, getOptions, RokuDeployOptions } from './index';
describe('createPackage', function () {
    let outputFilePath: string;
    let options: RokuDeployOptions;
    beforeEach(() => {
        options = getOptions();
        options.rootDir = './testProject';
        outputFilePath = path.join(<string>options.outDir, <string>options.outFile);
    });
    afterEach(async () => {
        //delete the output file and other interum files
        await Q.nfcall(fsExtra.remove, path.dirname(outputFilePath));
        await Q.nfcall(fsExtra.remove, '.tmp');
    });

    it('should create package in proper directory', async function () {
        await createPackage(options);
        let exists = fsExtra.existsSync(outputFilePath);
        assert.equal(exists, true);
    });

    it('should only include the specified files', async () => {
        try {
            console.log('starting test');
            options.files = ['manifest'];
            await createPackage(options);
            console.log(outputFilePath);
            var zip = new AdmZip(outputFilePath);
            await fsExtra.ensureDir('.tmp');
            zip.extractAllTo('.tmp/output', true);
            assert.equal(fsExtra.existsSync('./.tmp/output/manifest'), true);
            console.log('finishing test');
        } catch (e) {
            console.log(e);
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
});
