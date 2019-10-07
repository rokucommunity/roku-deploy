import * as assert from 'assert';
import * as chai from 'chai';
import * as chaiFiles from 'chai-files';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as AdmZip from 'adm-zip';
import * as nrc from 'node-run-cmd';
import * as sinonImport from 'sinon';
let sinon = sinonImport.createSandbox();

import { RokuDeploy, RokuDeployOptions, BeforeZipCallbackInfo, ManifestData } from './RokuDeploy';
import * as errors from './Errors';

chai.use(chaiFiles);

let n = path.normalize;

const expect = chai.expect;
const file = chaiFiles.file;
const dir = chaiFiles.dir;
let cwd = process.cwd();
const tmpPath = n(`${cwd}/.tmp`);

describe('index', function () {
    let rokuDeploy: RokuDeploy;
    //make an <any> ref to rokuDeploy to make some things easier
    let rd: any;
    beforeEach(() => {
        rokuDeploy = new RokuDeploy();
        rd = rokuDeploy;
    });

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

    describe('doPostRequest', function () {
        it('should not throw an error for a successful request', async () => {
            let body = 'responseBody';
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            let results = await (rokuDeploy as any).doPostRequest({});
            expect(results.body).to.equal(body);
        });

        it('should throw an error for a network error', async () => {
            let error = new Error('Network Error');
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, error);
                return {} as any;
            });

            try {
                await (rokuDeploy as any).doPostRequest({});
            } catch (e) {
                expect(e).to.equal(error);
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('doGetRequest', function () {
        it('should not throw an error for a successful request', async () => {
            let body = 'responseBody';
            sinon.stub(rokuDeploy.request, 'get').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            let results = await (rokuDeploy as any).doGetRequest({});
            expect(results.body).to.equal(body);
        });

        it('should throw an error for a network error', async () => {
            let error = new Error('Network Error');
            sinon.stub(rokuDeploy.request, 'get').callsFake((_, callback) => {
                process.nextTick(callback, error);
                return {} as any;
            });

            try {
                await (rokuDeploy as any).doGetRequest({});
            } catch (e) {
                expect(e).to.equal(error);
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('getDevId', function () {
        it('should return the current Dev ID if successful', async () => {
            let body = `{
                            var devDiv = document.createElement('div');
                            devDiv.className="roku-font-5";
                            devDiv.innerHTML = "<label>Your Dev ID: &nbsp;</label> c6fdc2019903ac3332f624b0b2c2fe2c733c3e74</label><hr />";
                            node.appendChild(devDiv);
                        }`;
            mockDoGetRequest(body);
            let devId = await rokuDeploy.getDevId(options);
            expect(devId).to.equal('c6fdc2019903ac3332f624b0b2c2fe2c733c3e74');
        });

        it('should throw our error on failure', async () => {
            mockDoGetRequest();
            try {
                await rokuDeploy.getDevId(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnparsableDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('createPackage', function () {
        it('works with custom stagingFolderPath', async () => {
            let opts = { ...options, stagingFolderPath: 'dist' };
            await rokuDeploy.createPackage(opts);
            expect(file(rokuDeploy.getOutputZipFilePath(opts))).to.exist;
        });

        it('should throw error when no files were found to copy', async () => {
            try {
                options.files = [];
                await rokuDeploy.createPackage(options);
            } catch (e) {
                assert.ok('Exception was thrown as expected');
                return;
            }
            assert.fail('Exception should have been thrown');
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

        it('should wait for promise returned by pre-zip callback', async () => {
            let count = 0;
            await rokuDeploy.createPackage(options, (info) => {
                return Promise.resolve().then(() => {
                    count++;
                }).then(() => {
                    count++;
                });
            });
            expect(count).to.equal(2);
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

        it('throws when package upload fails', async () => {
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

            try {
                await rokuDeploy.publish(options);
            } catch (e) {
                assert.ok('Exception was thrown as expected');
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('rejects when response contains compile error wording', () => {
            options.failOnCompileError = true;
            let body = 'Install Failure: Compilation Failed.';
            mockDoPostRequest(body);

            return rokuDeploy.publish(options).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err.message).to.equal('Compile error');
                expect(true).to.be.true;
            });
        });

        it('rejects when response contains invalid password status code', () => {
            options.failOnCompileError = true;
            mockDoPostRequest('', 401);

            return rokuDeploy.publish(options).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err.message).to.equal('Unauthorized. Please verify username and password for target Roku.');
                expect(true).to.be.true;
            });
        });

        it('handles successful deploy', () => {
            options.failOnCompileError = true;
            mockDoPostRequest();

            return rokuDeploy.publish(options).then((result) => {
                expect(result.message).to.equal('Successful deploy');
            }, (err) => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', () => {
            options.failOnCompileError = false;

            let body = 'Identical to previous version -- not replacing.';
            mockDoPostRequest(body);

            return rokuDeploy.publish(options).then((result) => {
                expect(result.results.body).to.equal(body);
            }, (err) => {
                assert.fail('Should have resolved promise');
            });
        });

        it('rejects when response is unknown status code', async () => {
            options.failOnCompileError = true;
            let body = 'Identical to previous version -- not replacing.';
            mockDoPostRequest(body, 123);

            try {
                await rokuDeploy.publish(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.InvalidDeviceResponseCodeError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('rejects when user is unauthorized', async () => {
            options.failOnCompileError = true;
            mockDoPostRequest('', 401);

            try {
                await rokuDeploy.publish(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnauthorizedDeviceResponseError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('rejects when encountering an undefined response', async () => {
            options.failOnCompileError = true;
            mockDoPostRequest(null);

            try {
                await rokuDeploy.publish(options);
            } catch (e) {
                assert.ok('Exception was thrown as expected');
                return;
            }
            assert.fail('Should not have succeeded');
        });

    });

    describe('convertToSquashfs', () => {
        it('should not return an error if successful', async () => {
            mockDoPostRequest('<font color="red">Conversion succeeded<p></p><code><br>Parallel mksquashfs: Using 1 processor');
            try {
                await rokuDeploy.convertToSquashfs(options);
            } catch (e) {
                assert.fail('Should not have been hit');
            }
        });

        it('should return MissingRequiredOptionError if host was not provided', async () => {
            mockDoPostRequest();
            try {
                options.host = undefined;
                await rokuDeploy.convertToSquashfs(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.MissingRequiredOptionError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('should return ConvertError if converting failed', async () => {
            mockDoPostRequest();
            try {
                await rokuDeploy.convertToSquashfs(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.ConvertError);
                return;
            }
            assert.fail('Should not have succeeded');
        });
    });

    describe('rekeyDevice', () => {
        beforeEach(() => {
            let body = `      {
                var devDiv = document.createElement('div');
                devDiv.className="roku-font-5";
                devDiv.innerHTML = "<label>Your Dev ID: &nbsp;</label> c6fdc2019903ac3332f624b0b2c2fe2c733c3e74</label><hr />";
                node.appendChild(devDiv);
            }`;
            mockDoGetRequest(body);
        });

        it('should work with relative path', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);

            options.rekeySignedPackage = '../testSignedPackage.pkg';
            await rokuDeploy.rekeyDevice(options);
        });

        it('should work with absolute path', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);

            options.rekeySignedPackage = path.join(path.resolve(options.rootDir, '../testSignedPackage.pkg'));
            await rokuDeploy.rekeyDevice(options);
        });

        it('should not return an error if dev ID is set and matches output', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);

            options.devId = 'c6fdc2019903ac3332f624b0b2c2fe2c733c3e74';
            await rokuDeploy.rekeyDevice(options);
        });

        it('should throw error if missing rekeySignedPackage option', async () => {
            try {
                options.rekeySignedPackage = null;
                await rokuDeploy.rekeyDevice(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.MissingRequiredOptionError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw error if missing signingPassword option', async () => {
            try {
                options.signingPassword = null;
                await rokuDeploy.rekeyDevice(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.MissingRequiredOptionError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw error if response is not parsable', async () => {
            try {
                mockDoPostRequest();
                await rokuDeploy.rekeyDevice(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnparsableDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw error if we could not verify a successful call', async () => {
            try {
                let body = `  <div style="display:none">
                    <font color="red">Invalid public key.</font>
                </div>`;
                mockDoPostRequest(body);
                await rokuDeploy.rekeyDevice(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.FailedDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw error if resulting Dev ID is not the one we are expecting', async () => {
            try {
                let body = `  <div style="display:none">
                    <font color="red">Success.</font>
                </div>`;
                mockDoPostRequest(body);

                options.devId = '45fdc2019903ac333ff624b0b2cddd2c733c3e74';
                await rokuDeploy.rekeyDevice(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnknownDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
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
            } catch (e) {
                expect(e.message).to.equal('Must supply signingPassword');
                return;
            }
            assert.fail('Exception should have been thrown');
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
            } catch (e) {
                expect(e).to.equal(error);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should return our error if it received invalid data', async () => {
            try {
                mockDoPostRequest(null);
                await rokuDeploy.signExistingPackage(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnparsableDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should return an error if failure returned in response', async () => {
            let body = `<div style="display:none">
                            <font color="red">Failed: Invalid Password.
                        </font>
                        </div>`;
            mockDoPostRequest(body);

            try {
                await rokuDeploy.signExistingPackage(options);
            } catch (e) {
                expect(e.message).to.equal('Invalid Password.');
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should return created pkg on success', async () => {
            let body = `var pkgDiv = document.createElement('div');
                        pkgDiv.innerHTML = '<label>Currently Packaged Application:</label><div><font face="Courier"><a href="pkgs//P6953175d5df120c0069c53de12515b9a.pkg">P6953175d5df120c0069c53de12515b9a.pkg</a> <br> package file (7360 bytes)</font></div>';
                        node.appendChild(pkgDiv);`;
            mockDoPostRequest(body);

            let pkgPath = await rokuDeploy.signExistingPackage(options);
            expect(pkgPath).to.equal('pkgs//P6953175d5df120c0069c53de12515b9a.pkg');
        });

        it('should return our fallback error if neither error or package link was detected', async () => {
            try {
                mockDoPostRequest();
                await rokuDeploy.signExistingPackage(options);
            } catch (e) {
                expect(e.message).to.equal('Unknown error signing package');
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('prepublishToStaging', () => {
        it('should use outDir for staging folder', async () => {
            await rokuDeploy.prepublishToStaging(options);
            expect(dir('out/.roku-deploy-staging')).to.exist;
        });

        it('should support overriding the staging folder', async () => {
            await rokuDeploy.prepublishToStaging({ ...options, stagingFolderPath: '.tmp/custom-out-dir' });
            expect(dir('.tmp/custom-out-dir')).to.exist;
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

    describe.only('normalizeFilesArray', () => {
        it('works for simple strings', () => {
            expect(rokuDeploy.normalizeFilesArray([
                'manifest',
                'source/main.brs'
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }, {
                src: 'source/main.brs',
                dest: undefined
            }]);
        });

        it('works for negated strings', () => {
            expect(rokuDeploy.normalizeFilesArray([
                '!.git',
            ])).to.eql([{
                src: '!.git',
                dest: undefined
            }]);
        });

        it('skips falsey and bogus entries', () => {
            expect(rokuDeploy.normalizeFilesArray([
                '',
                'manifest',
                <any>false,
                undefined,
                null
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }]);
        });

        it('works for {src:string} objects', () => {
            expect(rokuDeploy.normalizeFilesArray([
                {
                    src: 'manifest'
                }
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }]);
        });

        it('works for {src:string[]} objects', () => {
            expect(rokuDeploy.normalizeFilesArray([
                {
                    src: [
                        'manifest',
                        'source/main.brs'
                    ]
                }
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }, {
                src: 'source/main.brs',
                dest: undefined
            }]);
        });

        it('retains dest option', () => {
            expect(rokuDeploy.normalizeFilesArray([
                {
                    src: 'source/config.dev.brs',
                    dest: 'source/config.brs'
                }
            ])).to.eql([{
                src: 'source/config.dev.brs',
                dest: 'source/config.brs'
            }]);
        });

        it('throws when encountering invalid entries', () => {
            expect(() => rokuDeploy.normalizeFilesArray(<any>[true])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[/asdf/])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[new Date()])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[1])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[{ src: true }])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[{ src: /asdf/ }])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[{ src: new Date() }])).to.throw();
            expect(() => rokuDeploy.normalizeFilesArray(<any>[{ src: 1 }])).to.throw();
        });
    });

    describe('deploy', () => {
        it('does the whole migration', async () => {
            mockDoPostRequest();

            let result = await rokuDeploy.deploy();
            expect(result).not.to.be.undefined;
        });
    });

    describe('deleteInstalledChannel', () => {
        it('attempts to delete any installed dev channel on the device', async () => {
            mockDoPostRequest();

            let result = await rokuDeploy.deleteInstalledChannel();
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
            expect(parsedManifest.bs_const).to.equal('IS_DEV_BUILD=false');
            expect(parsedManifest.splash_color).to.equal('#000000');
        });

        it('Throws our error message for a missing file', async () => {
            let invalidManifestPath = 'invalid-path';
            try {
                await rokuDeploy.parseManifest(invalidManifestPath);
            } catch (e) {
                expect(e.message).to.equal(invalidManifestPath + ' does not exist');
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('stringifyManifest', () => {
        let inputManifestContents;
        let inputParsedManifest: ManifestData;

        beforeEach(async () => {
            let rootProjectDir = path.resolve(options.rootDir);
            let manifestPath = path.join(rootProjectDir, 'manifest');

            inputManifestContents = await fsExtra.readFile(manifestPath, 'utf-8');
            inputManifestContents = inputManifestContents.trim();
            inputParsedManifest = await rokuDeploy.parseManifestFromString(inputManifestContents);
        });

        it('correctly converts back to a valid manifest when lineNumber and keyIndexes are provided', async () => {
            let outputStringifiedManifest = rokuDeploy.stringifyManifest(inputParsedManifest);
            let outputNormalized = outputStringifiedManifest.replace(/\r\n/g, '\n');
            let inputNormalized = inputManifestContents.replace(/\r\n/g, '\n');
            expect(outputNormalized).to.equal(inputNormalized);
        });

        it('correctly converts back to a valid manifest when lineNumber and keyIndexes are not provided', async () => {
            delete inputParsedManifest.keyIndexes;
            delete inputParsedManifest.lineCount;
            let outputStringifiedManifest = rokuDeploy.stringifyManifest(inputParsedManifest);
            let outputParsedManifest = rokuDeploy.parseManifestFromString(outputStringifiedManifest);
            expect(outputParsedManifest.title).to.equal(inputParsedManifest.title);
            expect(outputParsedManifest.major_version).to.equal(inputParsedManifest.major_version);
            expect(outputParsedManifest.minor_version).to.equal(inputParsedManifest.minor_version);
            expect(outputParsedManifest.build_version).to.equal(inputParsedManifest.build_version);
            expect(outputParsedManifest.splash_screen_hd).to.equal(inputParsedManifest.splash_screen_hd);
            expect(outputParsedManifest.ui_resolutions).to.equal(inputParsedManifest.ui_resolutions);
            expect(outputParsedManifest.bs_const).to.equal(inputParsedManifest.bs_const);
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
        it('works with custom stagingFolderPath', async () => {
            let rootDir = n(`${tmpPath}/src`);
            await fsExtra.ensureDir(`${rootDir}/source`);
            await fsExtra.ensureDir(`${rootDir}/components`);

            await fsExtra.writeFile(`${rootDir}/source/main.brs`, '');
            await fsExtra.writeFile(`${rootDir}/manifest`, '');
            await fsExtra.writeFile(`${rootDir}/components/component1.xml`, '');

            let paths = (await rokuDeploy.getFilePaths(
                [
                    'source/**/*',
                    'components/**/*',
                    'manifest'
                ],
                'dist',
                rootDir
            )).sort((a, b) => a.src.localeCompare(b.src));

            expect(paths).to.eql([{
                src: path.join(rootDir, 'components', 'component1.xml'),
                dest: path.join(cwd, 'dist', 'components', 'component.xml')
            }, {
                src: path.join(rootDir, 'manifest'),
                dest: path.join(cwd, 'dist', 'manifest')
            }, {
                src: path.join(rootDir, 'source', 'main.brs'),
                dest: path.join(cwd, 'dist', 'source', 'main.brs')
            }]);
        });

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

    describe('retrieveSignedPackage', () => {
        let onHandler: any;
        beforeEach(() => {
            sinon.stub(rokuDeploy.fsExtra, 'ensureDir').callsFake((pth: string, callback: (err: Error) => void) => {
                //do nothing, assume the dir gets created
            });

            //fake out the write stream function
            sinon.stub(rokuDeploy.fsExtra, 'createWriteStream').returns(null);

            //intercept the http request
            sinon.stub(rokuDeploy.request, 'get').callsFake(() => {
                let request: any = {
                    on: (event, callback) => {
                        process.nextTick(() => {
                            onHandler(event, callback);
                        });
                        return request;
                    },
                    pipe: () => { }
                };
                return request;
            });

        });
        it('returns a pkg file path on success', async () => {
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200,
                    });
                }
            };
            let pkgFilePath = await rokuDeploy.retrieveSignedPackage('path_to_pkg', {
                outFile: 'roku-deploy-test'
            });
            expect(pkgFilePath).to.equal(path.join(process.cwd(), 'out', 'roku-deploy-test.pkg'));
        });

        it('throws when error in request is encountered', async () => {
            onHandler = (event, callback) => {
                if (event === 'error') {
                    callback(new Error('Some error'));
                }
            };
            try {
                await rokuDeploy.retrieveSignedPackage('path_to_pkg', {
                    outFile: 'roku-deploy-test'
                });
            } catch (e) {
                expect(e.message).to.equal('Some error');
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('throws when status code is non 200', async () => {
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 500
                    });
                }
            };
            try {
                await rokuDeploy.retrieveSignedPackage('path_to_pkg', {
                    outFile: 'roku-deploy-test'
                });
            } catch (e) {
                expect(e.message.indexOf('Invalid response code')).to.equal(0);
                return;
            }
            assert.fail('Should not have succeeded');
        });
    });

    describe('deployAndSignPackage', () => {
        beforeEach(() => {
            //pretend the deploy worked
            sinon.stub(rokuDeploy, 'deploy').returns(Promise.resolve<any>(null));
            //pretend the sign worked
            sinon.stub(rokuDeploy, 'signExistingPackage').returns(Promise.resolve<any>(null));
            //pretend fetching the signed package worked
            sinon.stub(rokuDeploy, 'retrieveSignedPackage').returns(Promise.resolve<any>('some_local_path'));
        });

        it('succeeds and does proper things with staging folder', async () => {
            let stub = sinon.stub(rd.fsExtra, 'remove').returns(Promise.resolve());

            //this should not fail
            let pkgFilePath = await rokuDeploy.deployAndSignPackage({
                retainStagingFolder: false
            });

            //the return value should equal what retrieveSignedPackage returned.
            expect(pkgFilePath).to.equal('some_local_path');

            //fsExtra.remove should have been called
            expect(stub.getCalls()).to.be.lengthOf(1);

            //call it again, but specify true for retainStagingFolder
            await rokuDeploy.deployAndSignPackage({
                retainStagingFolder: true
            });
            //call count should NOT increase
            expect(stub.getCalls()).to.be.lengthOf(1);

            //call it again, but don't specify retainStagingFolder at all (it should default to FALSE)
            await rokuDeploy.deployAndSignPackage({});
            //call count should NOT increase
            expect(stub.getCalls()).to.be.lengthOf(2);
        });

        it('converts to squashfs if we request it to', async () => {
            options.convertToSquashfs = true;
            let stub = sinon.stub(rokuDeploy, 'convertToSquashfs').returns(Promise.resolve<any>(null));
            await rokuDeploy.deployAndSignPackage(options);
            expect(stub.getCalls()).to.be.lengthOf(1);
        });
    });

    function mockDoGetRequest(body = '', statusCode = 200) {
        sinon.stub(rokuDeploy as any, 'doGetRequest').callsFake((params) => {
            let results = { response: { statusCode: statusCode }, body: body };
            (rokuDeploy as any).checkRequest(results);
            return Promise.resolve(results);
        });
    }

    function mockDoPostRequest(body = '', statusCode = 200) {
        sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params) => {
            let results = { response: { statusCode: statusCode }, body: body };
            (rokuDeploy as any).checkRequest(results);
            return Promise.resolve(results);
        });
    }

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
