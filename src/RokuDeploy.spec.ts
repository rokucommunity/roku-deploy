import * as assert from 'assert';
import * as chai from 'chai';
import * as chaiFiles from 'chai-files';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as AdmZip from 'adm-zip';
import * as nrc from 'node-run-cmd';
import * as sinonImport from 'sinon';
let sinon = sinonImport.createSandbox();

import { RokuDeploy, RokuDeployOptions, BeforeZipCallbackInfo } from './RokuDeploy';
import { Request } from 'request';

chai.use(chaiFiles);

const expect = chai.expect;
const file = chaiFiles.file;
const dir = chaiFiles.dir;

describe('index', function () {
    let rokuDeploy: RokuDeploy;
    //make an <any> ref to rokuDeploy to make some things easier
    let rd: any;
    beforeEach(() => {
        rokuDeploy = new RokuDeploy();
        rd = rokuDeploy;
    });
    let cwd = process.cwd();

    let options: RokuDeployOptions;
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
        sinon.restore();
    });

    describe('getStagingFolderPath', function () {
        it('returns correct path', async () => {
            let outputPath = rokuDeploy.getStagingFolderPath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), '.roku-deploy-staging'));
        });
    });

    describe('getOutputPkgFilePath', function () {
        it('should return correct path if given basename', async () => {
            options.outFile = 'roku-deploy';
            let outputPath = rokuDeploy.getOutputPkgFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), options.outFile + '.pkg'));
        });

        it('should return correct path if given outFile option ending in .zip', async () => {
            options.outFile = 'roku-deploy.zip';
            let outputPath = rokuDeploy.getOutputPkgFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), 'roku-deploy.pkg'));
        });
    });

    describe('getOutputZipFilePath', function () {
        it('should return correct path if given basename', async () => {
            options.outFile = 'roku-deploy';
            let outputPath = rokuDeploy.getOutputZipFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), options.outFile + '.zip'));
        });

        it('should return correct path if given outFile option ending in .zip', async () => {
            options.outFile = 'roku-deploy.zip';
            let outputPath = rokuDeploy.getOutputZipFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), 'roku-deploy.zip'));
        });
    });

    describe('createPackage', function () {
        it('should throw error when no files were found to copy', async () => {
            try {
                options.files = [];
                await rokuDeploy.createPackage(options);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                assert.ok('Exception was thrown as expected');
            }
        });

        it('should create package in proper directory', async function () {
            await rokuDeploy.createPackage(options);
            expect(file(rokuDeploy.getOutputZipFilePath(options))).to.exist;
        });

        it('should only include the specified files', async () => {
            try {
                options.files = ['manifest'];
                await rokuDeploy.createPackage(options);
                let zip = new AdmZip(rokuDeploy.getOutputZipFilePath(options));
                await fsExtra.ensureDir('.tmp');
                zip.extractAllTo('.tmp/output', true);
                expect(file('./.tmp/output/manifest')).to.exist;
            } catch (e) {
                throw e;
            }
        });

        it('generates full package with defaults', async () => {
            await rokuDeploy.createPackage(options);
            let zip = new AdmZip(rokuDeploy.getOutputZipFilePath(options));
            await fsExtra.ensureDir('.tmp');
            zip.extractAllTo('.tmp/output', true);
            expect(dir('./.tmp/output/components')).to.exist;
            expect(dir('./.tmp/output/images')).to.exist;
            expect(dir('./.tmp/output/source')).to.exist;
        });

        it('should retain the staging directory when told to', async () => {
            let stagingFolderPath = await rokuDeploy.prepublishToStaging(options);
            expect(dir(stagingFolderPath)).to.exist;
            options.retainStagingFolder = true;
            await rokuDeploy.zipPackage(options);
            expect(dir(stagingFolderPath)).to.exist;
        });

        it('should call our callback with correct information', async () => {
            let spy = sinon.spy((info: BeforeZipCallbackInfo) => {
                expect(dir(info.stagingFolderPath)).to.exist;
                expect(info.manifestData.major_version).to.equal('1');
            });

            await rokuDeploy.createPackage(options, spy);

            if (spy.notCalled) {
                assert.fail('Callback not called');
            }
        });

        it('should increment the build number if requested', async () => {
            options.incrementBuildNumber = true;
            await rokuDeploy.createPackage(options, (info) => {
                expect(info.manifestData.build_version).to.not.equal('0');
            });
        });

        it('should not increment the build number if not requested', async () => {
            options.incrementBuildNumber = false;
            await rokuDeploy.createPackage(options, (info) => {
                expect(info.manifestData.build_version).to.equal('0');
            });
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
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, new Error());
                return {} as any;
            });
            return rokuDeploy.pressHomeButton({}).then(() => {
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
            return rokuDeploy.publish({ host: undefined }).then(() => {
                assert.fail('Should not have succeeded');
            }, () => {
                expect(true).to.be.true;
            });
        });

        it('rejects when package upload fails', () => {
            //intercept the post requests
            sinon.stub(rokuDeploy.request, 'post').callsFake((data: any, callback: any) => {
                if (data.url === `http://${options.host}/plugin_install`) {
                    process.nextTick(() => {
                        callback(new Error('Failed to publish to server'));
                    });
                } else {
                    process.nextTick(callback);
                }
                return {} as any;
            });

            return rokuDeploy.publish(options).then(() => {
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
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, {}, body);
                return {} as any;
            });

            return rokuDeploy.publish(options).then(() => {
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
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 401 }, body);
                return {} as any;
            });

            return rokuDeploy.publish(options).then(() => {
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
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            return rokuDeploy.publish(options).then((result) => {
                expect(result.message).to.equal('Successful deploy');
            }, (err) => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', () => {
            options.failOnCompileError = false;

            let body = 'Identical to previous version -- not replacing.';
            //intercept the post requests
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            return rokuDeploy.publish(options).then((result) => {
                expect(result.results.body).to.equal(body);
            }, (err) => {
                assert.fail('Should have resolved promise');
            });
        });

        it('rejects when response is unknown error code', () => {
            options.failOnCompileError = true;
            let body = 'Identical to previous version -- not replacing.';
            //intercept the post requests
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 123 }, body);
                return {} as any;
            });

            return rokuDeploy.publish(options).then((result) => {
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
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, undefined, body);
                return {} as any;
            });

            return rokuDeploy.publish(options).then((result) => {
                expect(result.results.body).to.equal(body);
                assert.fail('Should have rejected promise');
            }, (err) => {
                expect(err.message).to.equal('Invalid response');
            });
        });

    });

    describe('signExistingPackage', () => {
        beforeEach(() => {
            let stagingFolderPath = rokuDeploy.getStagingFolderPath();
            fsExtra.ensureDirSync(stagingFolderPath);

            let src = path.join(options.rootDir, 'manifest');
            let dest = path.join(stagingFolderPath, 'manifest');
            fsExtra.copySync(src, dest);
        });

        it('should return our error if signingPassword is not supplied', async () => {
            options.signingPassword = undefined;
            try {
                await rokuDeploy.signExistingPackage(options);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e.message).to.equal('Must supply signingPassword');
            }
        });

        it('should return an error if there is a problem with the network request', async () => {
            let error = new Error('Network Error');
            try {
                //intercept the post requests
                sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                    process.nextTick(callback, error);
                    return {} as any;
                });
                await rokuDeploy.signExistingPackage(options);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e).to.equal(error);
            }
        });

        it('should return our error if it received invalid data', async () => {
            try {
                //intercept the post requests
                sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                    process.nextTick(callback);
                    return {} as any;
                });
                await rokuDeploy.signExistingPackage(options);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e.message).to.equal('Invalid response');
            }
        });

        it('should return an error if failure returned in response', async () => {
            // This is formatted exactly how it is output in the Roku's HTML body so mock matches exactly and less chance for test passing here but not in the actual device
            let body = `   <div style="display:none">
    <font color="red">Failed: Invalid Password.
</font>
  </div>`;
            //intercept the post requests
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, {}, body);
                return {} as any;
            });

            try {
                await rokuDeploy.signExistingPackage(options);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e.message).to.equal('Invalid Password.');
            }
        });

        it('should return created pkg on success', async () => {
            let body = `            var pkgDiv = document.createElement('div');
            pkgDiv.innerHTML = '<label>Currently Packaged Application:</label><div><font face="Courier"><a href="pkgs//P6953175d5df120c0069c53de12515b9a.pkg">P6953175d5df120c0069c53de12515b9a.pkg</a> <br> package file (7360 bytes)</font></div>';
            node.appendChild(pkgDiv);`;

            //intercept the post requests
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, {}, body);
                return {} as any;
            });

            let pkgPath = await rokuDeploy.signExistingPackage(options);
            expect(pkgPath).to.equal('pkgs//P6953175d5df120c0069c53de12515b9a.pkg');
        });

        it('should return our fallback error if neither error or package link was detected', async () => {
            try {
                //intercept the post requests
                sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                    process.nextTick(callback, undefined, {}, '');
                    return {} as any;
                });
                await rokuDeploy.signExistingPackage(options);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e.message).to.equal('Unknown error signing package');
            }
        });
    });

    describe('prepublishToStaging', () => {
        it('should use outDir for staging folder', async () => {
            await rokuDeploy.prepublishToStaging(options);
            expect(dir('out/.roku-deploy-staging')).to.exist;
        });

        it('handles old glob-style', async () => {
            options.files = [
                'manifest',
                'source/main.brs'
            ];
            await rokuDeploy.prepublishToStaging(options);
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
            await rokuDeploy.prepublishToStaging(options);
            expect(file('out/.roku-deploy-staging/source/main.brs')).to.exist;
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
            await rokuDeploy.prepublishToStaging(options);
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
            await rokuDeploy.prepublishToStaging(options);
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
            await rokuDeploy.prepublishToStaging(options);
            expect(file('out/.roku-deploy-staging/manifest')).to.exist;
        });

        it('handles excluded folders in glob pattern', async () => {
            options.files = [
                'manifest',
                'components/!(scenes)/**/*'
            ];
            options.retainStagingFolder = true;
            await rokuDeploy.prepublishToStaging(options);
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
            await rokuDeploy.prepublishToStaging(options);
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
                await rokuDeploy.prepublishToStaging(options);
                expect(true).to.be.false;
            } catch (e) {
                expect(true).to.be.true;
            }
        });

        it('retains subfolder structure', async () => {
            options.files = [
                'manifest',
                {
                    src: 'flavors/shared/resources',
                    dest: 'resources'
                }
            ];
            await rokuDeploy.prepublishToStaging(options);
            expect(file('out/.roku-deploy-staging/resources/images/fhd/image.jpg')).to.exist;
        });

        it('honors the trailing slash in dest', async () => {
            options.files = [
                'manifest',
                {
                    src: 'source/main.brs',
                    dest: 'source1/'
                }
            ];
            await rokuDeploy.prepublishToStaging(options);
            expect(file('out/.roku-deploy-staging/source1/main.brs')).to.exist;
        });

        it('handles multi-globs subfolder structure', async () => {
            options.files = [
                'manifest',
                {
                    //the relative structure after /resources should be retained
                    src: 'flavors/shared/resources/**/*',
                    dest: 'resources'
                }
            ];
            await rokuDeploy.prepublishToStaging(options);
            expect(file('out/.roku-deploy-staging/resources/images/fhd/image.jpg')).to.exist;
            expect(file('out/.roku-deploy-staging/resources/image.jpg')).not.to.exist;
        });

        describe('symlinks', () => {
            let sourcePath = path.join(cwd, 'testSymlinks.md');
            let symlinkPath = path.join(cwd, 'testProject', 'testSymlinks.md');

            beforeEach(cleanUp);
            afterEach(cleanUp);

            async function cleanUp() {
                try { await fsExtra.remove(sourcePath); } catch (e) { }
                //delete the symlink if it exists
                try { await fsExtra.remove(symlinkPath); } catch (e) { }
            }

            /**
             * Determine if we have permission to create symlinks
             */
            function getIsSymlinksPermitted() {
                let testSymlinkFile = path.join(cwd, 'symlinkIsAvailable.txt');
                //delete the symlink test file
                try { fsExtra.removeSync(testSymlinkFile); } catch (e) { }
                let isPermitted = false;
                //create the symlink file
                try {
                    fsExtra.symlinkSync(path.join(cwd, 'readme.md'), testSymlinkFile);
                    isPermitted = true;
                } catch {
                }
                //delete the symlink test file
                try { fsExtra.removeSync(testSymlinkFile); } catch (e) { }
                return isPermitted;
            }

            let symlinkIt = getIsSymlinksPermitted() ? it : it.skip;

            symlinkIt('are dereferenced properly', async () => {
                //create the actual file
                await fsExtra.writeFile(sourcePath, 'hello symlink');

                //the source file should exist
                expect(file(sourcePath)).to.exist;

                //create the symlink in testProject
                await fsExtra.symlink(sourcePath, symlinkPath);

                //the symlink file should exist
                expect(file(symlinkPath)).to.exist;

                options.files = [
                    'manifest',
                    'testSymlinks.md'
                ];
                await rokuDeploy.prepublishToStaging(options);
                let stagedFilePath = path.join(options.outDir, '.roku-deploy-staging', 'testSymlinks.md');
                expect(file(stagedFilePath)).to.exist;
                let fileContents = await fsExtra.readFile(stagedFilePath);
                expect(fileContents.toString()).to.equal('hello symlink');
            });
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
                }]);
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

        it('properly handles negated globs', async () => {
            expect(await rokuDeploy.normalizeFilesOption([
                'manifest',
                'components/**/*',
                '!components/scenes/**/*'
            ])).to.eql([{
                dest: '',
                src: [
                    'manifest',
                    'components/**/*',
                    '!components/scenes/**/*'
                ],
            }]);
        });

        it('appends trailing slash to dest when globs are used', async () => {
            let result = await rokuDeploy.normalizeFilesOption([{
                src: 'components/**/*',
                dest: 'components'
            }]);

            expect(result[0].dest).to.equal('components' + path.sep);
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
            ])).to.eql([{
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
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, '');
                return {} as any;
            });

            let result = await rokuDeploy.deploy();
            expect(result).not.to.be.undefined;
        });
    });

    describe('zipFolder', () => {
        //this is mainly done to hit 100% coverage, but why not ensure the errors are handled properly? :D
        it('rejects the promise when an error occurs', async () => {
            //zip path doesn't exist
            await assertThrowsAsync(async () => {
                await rokuDeploy.zipFolder('source', 'some/zip/path/that/does/not/exist');
            });
        });
    });

    describe('parseManifest', () => {
        it('correctly parses valid manifest', async () => {
            let rootProjectDir = path.resolve(options.rootDir);
            let manifestPath = path.join(rootProjectDir, 'manifest');
            let parsedManifest = await rokuDeploy.parseManifest(manifestPath);
            expect(parsedManifest.title).to.equal('RokuDeployTestChannel');
            expect(parsedManifest.major_version).to.equal('1');
            expect(parsedManifest.minor_version).to.equal('0');
            expect(parsedManifest.build_version).to.equal('0');
            expect(parsedManifest.splash_screen_hd).to.equal('pkg:/images/splash_hd.jpg');
            expect(parsedManifest.ui_resolutions).to.equal('hd');
        });

        it('Throws our error message for a missing file', async () => {
            let invalidManifestPath = 'invalid-path';
            try {
                await rokuDeploy.parseManifest(invalidManifestPath);
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e.message).to.equal(invalidManifestPath + ' does not exist');
            }
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

    describe('getFilePaths', () => {
        it('works when using a different current working directory than rootDir', async () => {
            let rootProjectDir = path.resolve(options.rootDir);
            let outDir = path.resolve(options.outDir);

            //sanity check, make sure it works without fiddling with cwd intact
            let paths = (await rokuDeploy.getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ], outDir, rootProjectDir)).sort((a, b) => a.src.localeCompare(b.src));

            expect(paths).to.eql([{
                src: path.join(rootProjectDir, 'images', 'splash_hd.jpg'),
                dest: path.join(outDir, 'images', 'splash_hd.jpg')
            }, {
                src: path.join(rootProjectDir, 'manifest'),
                dest: path.join(outDir, 'manifest')
            }]);

            //change the working directory and verify everything still works

            let wrongCwd = path.dirname(path.resolve(options.rootDir));
            process.chdir(wrongCwd);

            paths = (await rokuDeploy.getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ], outDir, rootProjectDir)).sort((a, b) => a.src.localeCompare(b.src));

            expect(paths).to.eql([{
                src: path.join(rootProjectDir, 'images', 'splash_hd.jpg'),
                dest: path.join(outDir, 'images', 'splash_hd.jpg')
            }, {
                src: path.join(rootProjectDir, 'manifest'),
                dest: path.join(outDir, 'manifest')
            }]);
        });

        it('supports absolute paths from outside of the rootDir', async () => {
            let outDir = path.resolve(options.outDir);
            let rootProjectDir = path.resolve(options.rootDir);

            let paths = await rokuDeploy.getFilePaths([
                path.join(cwd, 'readme.md')
            ], outDir, rootProjectDir);

            expect(paths).to.eql([{
                src: path.join(cwd, 'readme.md'),
                dest: path.join(outDir, 'readme.md')
            }]);

            paths = await rokuDeploy.getFilePaths([{
                src: path.join(cwd, 'readme.md'),
                dest: 'docs'
            }], outDir, rootProjectDir);

            expect(paths).to.eql([{
                src: path.join(cwd, 'readme.md'),
                dest: path.join(outDir, 'docs', 'readme.md')
            }]);
        });

        it('supports relative paths that grab files from outside of the rootDir', async () => {
            let outDir = path.resolve(options.outDir);
            let rootProjectDir = path.resolve(options.rootDir);

            let paths = await rokuDeploy.getFilePaths([
                path.join('..', 'readme.md')
            ], outDir, rootProjectDir);

            expect(paths).to.eql([{
                src: path.join(cwd, 'readme.md'),
                dest: path.join(outDir, 'readme.md')
            }]);

            paths = await rokuDeploy.getFilePaths([{
                src: path.join('..', 'readme.md'),
                dest: 'docs'
            }], outDir, rootProjectDir);

            expect(paths).to.eql([{
                src: path.join(cwd, 'readme.md'),
                dest: path.join(outDir, 'docs', 'readme.md')
            }]);
        });
    });

    describe('normalizeRootDir', () => {
        it('handles falsey values', () => {
            expect(rokuDeploy.normalizeRootDir(null)).to.equal(cwd);
            expect(rokuDeploy.normalizeRootDir(undefined)).to.equal(cwd);
            expect(rokuDeploy.normalizeRootDir('')).to.equal(cwd);
            expect(rokuDeploy.normalizeRootDir(' ')).to.equal(cwd);
            expect(rokuDeploy.normalizeRootDir('\t')).to.equal(cwd);
        });

        it('handles non-falsey values', () => {
            expect(rokuDeploy.normalizeRootDir(cwd)).to.equal(cwd);
            expect(rokuDeploy.normalizeRootDir('./')).to.equal(cwd);
            expect(rokuDeploy.normalizeRootDir('./testProject')).to.equal(path.join(cwd, 'testProject'));
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
});

// class MockRequest {
//     constructor(
//         private request: Request
//     ) {
//         //overwrite the request with mocks
//         sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => process.nextTick(callback, new Error()));

//     }
// }