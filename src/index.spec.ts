import * as  assert from 'assert';
import * as chai from 'chai';
import * as chaiFiles from 'chai-files';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as Q from 'q';
import * as AdmZip from 'adm-zip';
import * as nrc from 'node-run-cmd';
import * as td from 'testdouble';

import { createPackage, deploy, getOptions, publish, prepublishToStaging, zipPackage, RokuDeployOptions, __request, pressHomeButton, normalizeFilesOption } from './index';
import * as rokuDeploy from './index';

chai.use(chaiFiles);
const expect = chai.expect;
const file = chaiFiles.file;
const dir = chaiFiles.dir;

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
        expect(file(getOutputFilePath())).to.exist;
    });

    it('should only include the specified files', async () => {
        try {
            options.files = ['manifest'];
            await createPackage(options);
            let zip = new AdmZip(getOutputFilePath());
            await fsExtra.ensureDir('.tmp');
            zip.extractAllTo('.tmp/output', true);
            expect(file('./.tmp/output/manifest')).to.exist;
        } catch (e) {
            throw e;
        }
    });

    it('generates full package with defaults', async () => {
        await createPackage(options);
        let zip = new AdmZip(getOutputFilePath());
        await fsExtra.ensureDir('.tmp');
        zip.extractAllTo('.tmp/output', true);
        expect(dir('./.tmp/output/components')).to.exist;
        expect(dir('./.tmp/output/images')).to.exist;
        expect(dir('./.tmp/output/source')).to.exist;
    });

    it('should retain the staging directory when told to', async () => {
        let stagingFolderPath = await prepublishToStaging(options);
        expect(dir(stagingFolderPath)).to.exist;
        options.retainStagingFolder = true;
        await zipPackage(options);
        expect(dir(stagingFolderPath)).to.exist;
    });
});

it('runs via the command line using the rokudeploy.json file', function (done) {
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
        expect(file('rokudeploy.json')).not.to.exist;
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
        expect(dir('out/.roku-deploy-staging')).to.exist;
    });

    it('handles old glob-style', async () => {
        options.files = [
            'manifest',
            'source/main.brs'
        ];
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/manifest')).to.exist;
        expect(file('out/.roku-deploy-staging/source/main.brs')).to.exist;
    });

    it('handles copying a simple directory by name using src;dest;', async () => {
        options.files = [
            'manifest',
            {
                src: 'source',
                dest: 'source'
            }
        ];
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/source/main.brs')).to.exist;
    });

    it('throws when src matches multiple files, but dest does not end in a slash', async () => {
        options.files = [
            {
                src: 'manifest',
                dest: ''
            },
            {
                src: 'source/**/*',
                dest: 'source'
            }
        ];
        try {
            await prepublishToStaging(options);
            expect('Should not have run this line').to.be.false;
        } catch (e) {
            let expectedMessage = 'Files entry matched multiple files';
            let actualMessage = e.message.substring(0, expectedMessage.length);

            if (expectedMessage !== actualMessage) {
                expect(e.message).to.equal(expectedMessage);
            }
        }
    });

    it('handles new src;dest style', async () => {
        options.files = [
            {
                src: 'manifest',
                dest: ''
            },
            {
                src: 'source/**/*',
                dest: 'source/'
            },
            {
                src: 'source/main.brs',
                dest: 'source/main.brs'
            }
        ];
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/manifest')).to.exist;
        expect(file('out/.roku-deploy-staging/source/main.brs')).to.exist;
    });

    it('handles renaming files', async () => {
        options.files = [
            {
                src: 'manifest',
                dest: ''
            },
            {
                src: 'source/main.brs',
                dest: 'source/renamed.brs'
            }
        ];
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/source/renamed.brs')).to.exist;
    });

    it('handles absolute src paths', async () => {
        let absoluteManifestPath = path.resolve('./testProject/manifest');
        options.files = [
            {
                src: absoluteManifestPath,
                dest: ''
            },
            {
                src: 'source/main.brs',
                dest: 'source/renamed.brs'
            }
        ];
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/manifest')).to.exist;
    });

    it('handles excluded folders in glob pattern', async () => {
        options.files = [
            'manifest',
            'components/!(scenes)/**/*'
        ];
        options.retainStagingFolder = true;
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/components/components/Loader/Loader.brs')).to.exist;
        expect(file('out/.roku-deploy-staging/components/scenes/Home/Home.brs')).not.to.exist;
    });

    it('handles multi-globs', async () => {
        options.files = [
            'manifest',
            { src: 'source', dest: 'dest' },
            'components/**/*',
            '!components/scenes/**/*'
        ];
        options.retainStagingFolder = true;
        await prepublishToStaging(options);
        expect(file('out/.roku-deploy-staging/components/components/Loader/Loader.brs')).to.exist;
        expect(file('out/.roku-deploy-staging/components/scenes/Home/Home.brs')).not.to.exist;
    });

    it('throws on invalid entries', async () => {
        options.files = [
            'manifest',
            <any>{}
        ];
        options.retainStagingFolder = true;
        try {
            await prepublishToStaging(options);
            expect(true).to.be.false;
        } catch (e) {
            expect(true).to.be.true;
        }
    });
});

describe('makeFilesAbsolute', () => {
    it('handles negated entries', () => {
        expect(
            rokuDeploy.makeFilesAbsolute([{
                dest: '',
                src: [
                    'components/**/*',
                    '!components/scenes/**/*'
                ]
            }], 'C:/somepath/')
        ).to.eql([{
            dest: '',
            src: [
                path.normalize('C:/somepath/components/**/*'),
                `!${path.normalize('C:/somepath/components/scenes/**/*')}`
            ]
        }]);
    });
});

describe('normalizeFilesOption', () => {
    it('appends trailing slash for dest directories', async () => {
        await assertThrowsAsync(async () => {
            await rokuDeploy.normalizeFilesOption([{
                src: 'components',
                //bogus dest object
                dest: <any>true
            }], options.rootDir);
        });
    });

    it('defaults to current directory', async () => {
        expect(await rokuDeploy.normalizeFilesOption([
            'readme.md',
        ])).to.eql([{
            dest: '',
            src: [
                'readme.md'
            ]
        }]);
    });

    it('glob-ifies top-level folder name', async () => {
        expect(await rokuDeploy.normalizeFilesOption([
            'manifest',
            'components'
        ], options.rootDir)).to.eql([{
            dest: '',
            src: [
                'manifest'
            ]
        }, {
            dest: 'components' + path.sep,
            src: [
                'components/**/*'
            ]
        }]);
    });

    it('glob-ifies src-level folder name', async () => {
        expect(await rokuDeploy.normalizeFilesOption([
            'manifest',
            {
                src: 'components'
            }
        ], options.rootDir)).to.eql([{
            dest: '',
            src: [
                'manifest'
            ],
        }, {
            dest: '',
            src: [
                'components/**/*'
            ]
        }]);
    });

    it('properly handles negated globs', async () => {
        expect(await rokuDeploy.normalizeFilesOption([
            'manifest',
            'components/**/*',
            '!components/scenes/**/*'
        ], options.rootDir)).to.eql([{
            dest: '',
            src: [
                'manifest',
                'components/**/*',
                '!components/scenes/**/*'
            ],
        }]);
    });

    it('properly handles negated globs with {src}', async () => {
        expect(await rokuDeploy.normalizeFilesOption([
            'manifest',
            {
                src: [
                    'components/**/*',
                    '!components/scenes/**/*'
                ]
            },
            'someOtherFile.brs'
        ], options.rootDir)).to.eql([{
            src: [
                'manifest',
                'someOtherFile.brs'
            ],
            dest: '',
        }, {
            src: [
                'components/**/*',
                '!components/scenes/**/*'
            ],
            dest: '',
        }]);
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

describe('zipFolder', () => {
    //this is mainly done to hit 100% coverage, but why not ensure the errors are handled properly? :D 
    it('rejects the promise when an error occurrs', async () => {
        //zip path doesn't exist
        await assertThrowsAsync(async () => {
            await rokuDeploy.zipFolder('source', 'some/zip/path/that/does/not/exist');
        });
    });
});

describe('endsWithSlash', () => {
    it('detects slashes', () => {
        expect(rokuDeploy.endsWithSlash('/')).to.be.true;
        expect(rokuDeploy.endsWithSlash('\\')).to.be.true;
    });

    it('detects non slashes', () => {
        expect(rokuDeploy.endsWithSlash('a')).to.be.false;
        expect(rokuDeploy.endsWithSlash('')).to.be.false;
        expect(rokuDeploy.endsWithSlash(' ')).to.be.false;
        expect(rokuDeploy.endsWithSlash('.')).to.be.false;
    });
});

async function assertThrowsAsync(fn) {
    let f = () => { };
    try {
        await fn();
    } catch (e) {
        f = () => { throw e; };
    } finally {
        assert.throws(f);
    }
}