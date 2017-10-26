import * as  assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as Q from 'q';
import * as AdmZip from 'adm-zip';

import { createPackage, getOptions, RokuDeployOptions, getUpDirCount } from './index';
describe('createPackage', function () {
    let outputFilePath: string;
    let options: RokuDeployOptions;
    beforeEach(() => {
        options = getOptions();
        options.rootDir = './testProject';
        outputFilePath = path.join(<string>options.outDir, <string>options.outFile);
    });
    afterEach(async () => {
        //delete the output file 
        //await Q.nfcall(fsExtra.remove, path.dirname(outputFilePath));
    });

    it('should create package in proper directory', async function () {
        await createPackage(options);
        let exists = fsExtra.existsSync(outputFilePath);
        assert.equal(exists, true);
    });

    it.only('should only include the specified files', async () => {
        try {
            console.log('starting test');
            options.files = ['manifest'];
            await createPackage(options);
            console.log(outputFilePath);
            var zip = new AdmZip(outputFilePath);
            await fsExtra.ensureDir('.tmp');
            zip.extractAllTo('.tmp/output', true);
            assert.equal(fsExtra.existsSync('./tmp/output/manifest'), true);
            console.log('finishing test');
            //await Q.nfncall(fsExtra.remove('./tmp'));
        } catch (e) {
            console.log(e);
            throw e;
        }
    });
});

describe('getUpDirCount', () => {
    it('works', () => {
        assert.equal(getUpDirCount('C:/projects/a', 'C:/projects/a/b/c/manifest'), 2);
        assert.equal(getUpDirCount('C:/projects/a', 'C:/projects/a/b/manifest'), 1);
        assert.equal(getUpDirCount('C:/projects/a', 'C:/projects/a/manifest'), 0);
        assert.equal(getUpDirCount(
            'c:\\projects\\roku-deploy\\.roku-deploy-staging',
            'c:/projects/roku-deploy/.roku-deploy-staging/testProject/manifest'),
            1
        );

        //should throw an exception
        assert.throws(() => {
            getUpDirCount('C:/projects/a', 'C:/projects');
        });
    });
});