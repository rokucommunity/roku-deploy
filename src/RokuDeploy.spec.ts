import * as assert from 'assert';
import * as chai from 'chai';
import * as chaiFiles from 'chai-files';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as JSZip from 'jszip';
import * as nrc from 'node-run-cmd';
import { createSandbox } from 'sinon';
let sinon = createSandbox();
import * as deferred from 'deferred';
import * as glob from 'glob';
import { RokuDeploy, BeforeZipCallbackInfo, ManifestData } from './RokuDeploy';
import * as errors from './Errors';
import { util, standardizePath as s } from './util';
import { FileEntry, RokuDeployOptions } from './RokuDeployOptions';

chai.use(chaiFiles);

const expect = chai.expect;
const file = chaiFiles.file;
const dir = chaiFiles.dir;
let cwd = process.cwd();
const tmpPath = s`${cwd}/.tmp`;

describe('index', () => {
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

        //delete the output file and other interim files
        let filePaths = [
            path.resolve(options.outDir),
            tmpPath
        ];
        for (let filePath of filePaths) {
            try {
                fsExtra.removeSync(filePath);
            } catch (e) { }
        }
        sinon.restore();
    });

    describe('getOutputPkgFilePath', () => {
        it('should return correct path if given basename', () => {
            options.outFile = 'roku-deploy';
            let outputPath = rokuDeploy.getOutputPkgFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), options.outFile + '.pkg'));
        });

        it('should return correct path if given outFile option ending in .zip', () => {
            options.outFile = 'roku-deploy.zip';
            let outputPath = rokuDeploy.getOutputPkgFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), 'roku-deploy.pkg'));
        });
    });

    describe('getOutputZipFilePath', () => {
        it('should return correct path if given basename', () => {
            options.outFile = 'roku-deploy';
            let outputPath = rokuDeploy.getOutputZipFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), options.outFile + '.zip'));
        });

        it('should return correct path if given outFile option ending in .zip', () => {
            options.outFile = 'roku-deploy.zip';
            let outputPath = rokuDeploy.getOutputZipFilePath(options);
            expect(outputPath).to.equal(path.join(path.resolve(options.outDir), 'roku-deploy.zip'));
        });
    });

    describe('doPostRequest', () => {
        it('should not throw an error for a successful request', async () => {
            let body = 'responseBody';
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            let results = await (rokuDeploy as any).doPostRequest({}, true);
            expect(results.body).to.equal(body);
        });

        it('should throw an error for a network error', async () => {
            let error = new Error('Network Error');
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, error);
                return {} as any;
            });

            try {
                await (rokuDeploy as any).doPostRequest({}, true);
            } catch (e) {
                expect(e).to.equal(error);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw an error for a wrong response code if verify is true', async () => {
            let body = 'responseBody';
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 500 }, body);
                return {} as any;
            });

            try {
                await (rokuDeploy as any).doPostRequest({}, true);
            } catch (e) {
                expect(e).to.be.instanceof(errors.InvalidDeviceResponseCodeError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should not throw an error for a response code if verify is false', async () => {
            let body = 'responseBody';
            sinon.stub(rokuDeploy.request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 500 }, body);
                return {} as any;
            });

            let results = await (rokuDeploy as any).doPostRequest({}, false);
            expect(results.body).to.equal(body);
        });
    });

    describe('doGetRequest', () => {
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

    describe('getRokuMessagesFromResponseBody', () => {
        it('exits on unknown message type', () => {
            const result = rokuDeploy['getRokuMessagesFromResponseBody'](`
                Shell.create('Roku.Message').trigger('Set message type', 'unknown').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);
            `);
            expect(result).to.eql({
                errors: [],
                infos: [],
                successes: []
            });
        });

        it('pull errors from the response body', () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);
            `);

            let results = rokuDeploy['getRokuMessagesFromResponseBody'](body);
            expect(results).to.eql({
                errors: ['Failure: Form Error: "archive" Field Not Found'],
                infos: [],
                successes: []
            });
        });

        it('pull successes from the response body', () => {
            let body = getFakeResponseBody(`
            Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);
            `);

            let results = rokuDeploy['getRokuMessagesFromResponseBody'](body);
            expect(results).to.eql({
                errors: [],
                infos: [],
                successes: ['Screenshot ok']
            });
        });

        it('pull many messages from the response body', () => {
            let body = getFakeResponseBody(`
            Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'info').trigger('Set message content', 'Some random info message').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);
            `);

            let results = rokuDeploy['getRokuMessagesFromResponseBody'](body);
            expect(results).to.eql({
                errors: ['Failure: Form Error: "archive" Field Not Found', 'Failure: Form Error: "archive" Field Not Found'],
                infos: ['Some random info message'],
                successes: ['Screenshot ok']
            });
        });
    });

    describe('getDeviceInfo', () => {
        it('should return device info matching what was returned by ECP', async () => {
            const expectedSerialNumber = 'expectedSerialNumber';
            const expectedDeviceId = 'expectedDeviceId';
            const expectedDeveloperId = 'expectedDeveloperId';
            const body = `<device-info>
                <udn>29380007-0800-1025-80a4-d83154332d7e</udn>
                <serial-number>${expectedSerialNumber}</serial-number>
                <device-id>${expectedDeviceId}</device-id>
                <advertising-id>2cv488ca-d6ec-5222-9304-1925e72d0122</advertising-id>
                <vendor-name>Roku</vendor-name>
                <model-name>Roku Ultra</model-name>
                <model-number>4660X</model-number>
                <model-region>US</model-region>
                <is-tv>false</is-tv>
                <is-stick>false</is-stick>
                <supports-ethernet>true</supports-ethernet>
                <wifi-mac>d8:31:34:33:6d:6e</wifi-mac>
                <wifi-driver>realtek</wifi-driver>
                <has-wifi-extender>false</has-wifi-extender>
                <has-wifi-5G-support>true</has-wifi-5G-support>
                <can-use-wifi-extender>true</can-use-wifi-extender>
                <ethernet-mac>e8:31:34:36:2d:2e</ethernet-mac>
                <network-type>ethernet</network-type>
                <friendly-device-name>Brian's Roku Ultra</friendly-device-name>
                <friendly-model-name>Roku Ultra</friendly-model-name>
                <default-device-name>Roku Ultra - YB0072009656</default-device-name>
                <user-device-name>Brian's Roku Ultra</user-device-name>
                <user-device-location>Hot Tub</user-device-location>
                <build-number>469.30E04170A</build-number>
                <software-version>9.3.0</software-version>
                <software-build>4170</software-build>
                <secure-device>true</secure-device>
                <language>en</language>
                <country>US</country>
                <locale>en_US</locale>
                <time-zone-auto>true</time-zone-auto>
                <time-zone>US/Eastern</time-zone>
                <time-zone-name>United States/Eastern</time-zone-name>
                <time-zone-tz>America/New_York</time-zone-tz>
                <time-zone-offset>-240</time-zone-offset>
                <clock-format>12-hour</clock-format>
                <uptime>19799</uptime>
                <power-mode>PowerOn</power-mode>
                <supports-suspend>false</supports-suspend>
                <supports-find-remote>true</supports-find-remote>
                <find-remote-is-possible>true</find-remote-is-possible>
                <supports-audio-guide>true</supports-audio-guide>
                <supports-rva>true</supports-rva>
                <developer-enabled>true</developer-enabled>
                <keyed-developer-id>${expectedDeveloperId}</keyed-developer-id>
                <search-enabled>true</search-enabled>
                <search-channels-enabled>true</search-channels-enabled>
                <voice-search-enabled>true</voice-search-enabled>
                <notifications-enabled>true</notifications-enabled>
                <notifications-first-use>false</notifications-first-use>
                <supports-private-listening>true</supports-private-listening>
                <headphones-connected>false</headphones-connected>
                <supports-ecs-textedit>true</supports-ecs-textedit>
                <supports-ecs-microphone>true</supports-ecs-microphone>
                <supports-wake-on-wlan>false</supports-wake-on-wlan>
                <has-play-on-roku>true</has-play-on-roku>
                <has-mobile-screensaver>true</has-mobile-screensaver>
                <support-url>roku.com/support</support-url>
                <grandcentral-version>3.1.39</grandcentral-version>
                <trc-version>3.0</trc-version>
                <trc-channel-version>2.9.42</trc-channel-version>
                <davinci-version>2.8.20</davinci-version>
            </device-info>`;
            mockDoGetRequest(body);
            const deviceInfo = await rokuDeploy.getDeviceInfo(options);
            expect(deviceInfo['serial-number']).to.equal(expectedSerialNumber);
            expect(deviceInfo['device-id']).to.equal(expectedDeviceId);
            expect(deviceInfo['keyed-developer-id']).to.equal(expectedDeveloperId);
        });

        it('should throw our error on failure', async () => {
            mockDoGetRequest();
            try {
                await rokuDeploy.getDeviceInfo(options);
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnparsableDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });


    describe('getDevId', () => {
        it('should return the current Dev ID if successful', async () => {
            const expectedDevId = 'expectedDevId';
            const body = `<device-info>
                <keyed-developer-id>${expectedDevId}</keyed-developer-id>
            </device-info>`;
            mockDoGetRequest(body);
            options.devId = expectedDevId;
            let devId = await rokuDeploy.getDevId(options);
            expect(devId).to.equal(expectedDevId);
        });
    });

    describe('copyToStaging', () => {
        it('throws exceptions when rootDir does not exist', async () => {
            await expectThrowsAsync(
                () => (rokuDeploy as any).copyToStaging([], 'staging', 'folder_does_not_exist')
            );
        });
        it('throws exceptions on missing stagingPath', async () => {
            await expectThrowsAsync(
                () => (rokuDeploy as any).copyToStaging([])
            );
        });
        it('throws exceptions on missing rootDir', async () => {
            await expectThrowsAsync(
                () => (rokuDeploy as any).copyToStaging([], 'asdf')
            );
        });
        it('computes absolute path for all operations', async () => {
            const ensureDirPaths = [];
            sinon.stub(rokuDeploy.fsExtra, 'ensureDir').callsFake((p) => {
                ensureDirPaths.push(p);
                return Promise.resolve;
            });
            const copyPaths = [] as Array<{ src: string; dest: string }>;
            sinon.stub(rokuDeploy.fsExtra as any, 'copy').callsFake((src, dest) => {
                copyPaths.push({ src: src, dest: dest });
                return Promise.resolve();
            });

            let rootDir = s`${tmpPath}/ProjectA/src`;
            fsExtra.ensureDirSync(rootDir);
            let stagingPath = s`${tmpPath}/ProjectA/.staging`;

            sinon.stub(rokuDeploy, 'getFilePaths').returns(
                Promise.resolve([
                    {
                        src: s`${rootDir}/source/main.brs`,
                        dest: '/source/main.brs'
                    }, {
                        src: s`${rootDir}/components/a/b/c/comp1.xml`,
                        dest: '/components/a/b/c/comp1.xml'
                    }
                ])
            );

            await (rokuDeploy as any).copyToStaging([], stagingPath, rootDir);

            expect(ensureDirPaths).to.eql([
                s`${stagingPath}/source`,
                s`${stagingPath}/components/a/b/c`
            ]);

            expect(copyPaths).to.eql([
                {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`${stagingPath}/source/main.brs`
                }, {
                    src: s`${rootDir}/components/a/b/c/comp1.xml`,
                    dest: s`${stagingPath}/components/a/b/c/comp1.xml`
                }
            ]);
        });
    });

    describe('zipPackage', () => {
        it('should throw error when manifest is missing', async () => {
            let err: Error;
            try {
                options.stagingFolderPath = s`${tmpPath}/path/to/nowhere`;
                fsExtra.ensureDirSync(options.stagingFolderPath);
                await rokuDeploy.zipPackage(options);
            } catch (e) {
                err = e;
            }
            expect(err).to.exist;
            expect(err.message.startsWith('Cannot zip'), `Unexpected error message: "${err.message}"`).to.be.true;
        });

        it('should throw error when manifest is missing and stagingDir does not exist', async () => {
            let err: Error;
            try {
                options.stagingFolderPath = s`${tmpPath}/path/to/nowhere`;
                await rokuDeploy.zipPackage(options);
            } catch (e) {
                err = e;
            }
            expect(err).to.exist;
            expect(err.message.startsWith('Cannot zip'), `Unexpected error message: "${err.message}"`).to.be.true;
        });

    });

    describe('createPackage', () => {
        it('works with custom stagingFolderPath', async () => {
            let opts = {
                ...options,
                files: [
                    'manifest'
                ],
                stagingFolderPath: '.tmp/dist'
            };
            await rokuDeploy.createPackage(opts);
            expect(file(rokuDeploy.getOutputZipFilePath(opts))).to.exist;
        });

        it('should throw error when no files were found to copy', async () => {
            await assertThrowsAsync(async () => {
                options.files = [];
                await rokuDeploy.createPackage(options);
            });
        });

        it('should create package in proper directory', async () => {
            await rokuDeploy.createPackage({
                ...options,
                files: [
                    'manifest'
                ]
            });
            expect(file(rokuDeploy.getOutputZipFilePath(options))).to.exist;
        });

        it('should only include the specified files', async () => {
            const files = ['manifest'];
            options.files = files;
            await rokuDeploy.createPackage(options);
            const data = fsExtra.readFileSync(rokuDeploy.getOutputZipFilePath(options));
            const zip = await JSZip.loadAsync(data);

            for (const file of files) {
                const zipFileContents = await zip.file(file.toString()).async('string');
                const sourcePath = path.join(options.rootDir, file);
                const incomingContents = fsExtra.readFileSync(sourcePath, 'utf8');
                expect(zipFileContents).to.equal(incomingContents);
            }
        });

        it('generates full package with defaults', async () => {
            const files = [
                'components/components/Loader/Loader.brs',
                'images/splash_hd.jpg',
                'source/main.brs',
                'manifest'
            ];
            await rokuDeploy.createPackage({
                ...options,
                //target a subset of the files to make the test faster
                files: files
            });

            const data = fsExtra.readFileSync(rokuDeploy.getOutputZipFilePath(options));
            const zip = await JSZip.loadAsync(data);

            for (const file of files) {
                const zipFileContents = await zip.file(file.toString()).async('string');
                const sourcePath = path.join(options.rootDir, file);
                const incomingContents = fsExtra.readFileSync(sourcePath, 'utf8');
                expect(zipFileContents).to.equal(incomingContents);
            }
        });

        it('should retain the staging directory when told to', async () => {
            let stagingFolderPath = await rokuDeploy.prepublishToStaging({
                ...options,
                files: [
                    'manifest'
                ]
            });
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
            await rokuDeploy.createPackage({
                ...options,
                files: ['manifest']
            }, (info) => {
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
            //make the zipping immediately resolve
            sinon.stub(rokuDeploy, 'zipPackage').returns(Promise.resolve());
            let beforeZipInfo: BeforeZipCallbackInfo;
            await rokuDeploy.createPackage({
                ...options,
                files: ['manifest']
            }, (info) => {
                beforeZipInfo = info;
            });
            expect(beforeZipInfo.manifestData.build_version).to.not.equal('0');
        });

        it('should not increment the build number if not requested', async () => {
            options.incrementBuildNumber = false;
            await rokuDeploy.createPackage({
                ...options,
                files: [
                    'manifest'
                ]
            }, (info) => {
                expect(info.manifestData.build_version).to.equal('0');
            });
        });
    });

    it('runs via the command line using the rokudeploy.json file', function test(done) {
        this.timeout(20000);
        nrc.run('node dist/index.js', {
            onData: (data) => {
            }
        }).then(() => {
            assert.ok('deploy succeeded');
            done();
        }, () => {
            assert.fail('deploy failed');
            done();
        });
    });

    describe('generateBaseRequestOptions', () => {
        it('uses default port', () => {
            expect((rokuDeploy as any).generateBaseRequestOptions('a_b_c', { host: '1.2.3.4' }).url).to.equal('http://1.2.3.4:80/a_b_c');
        });

        it('uses overridden port', () => {
            expect((rokuDeploy as any).generateBaseRequestOptions('a_b_c', { host: '1.2.3.4', packagePort: 999 }).url).to.equal('http://1.2.3.4:999/a_b_c');
        });
    });

    describe('pressHomeButton', () => {
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

        it('uses default port', async () => {
            const d = deferred();
            sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                expect(opts.url).to.equal('http://1.2.3.4:8060/keypress/Home');
                d.resolve();
            });
            await rokuDeploy.pressHomeButton('1.2.3.4');
            await d.promise;
        });

        it('uses overridden port', async () => {
            const d = deferred();
            sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                expect(opts.url).to.equal('http://1.2.3.4:987/keypress/Home');
                d.resolve();
            });
            await rokuDeploy.pressHomeButton('1.2.3.4', 987);
            await d.promise;
        });

        it('uses default timeout', async () => {
            const d = deferred();
            sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                expect(opts.url).to.equal('http://1.2.3.4:8060/keypress/Home');
                expect(opts.timeout).to.equal(150000);
                d.resolve();
            });
            await rokuDeploy.pressHomeButton('1.2.3.4');
            await d.promise;
        });

        it('uses overridden timeout', async () => {
            const d = deferred();
            sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                expect(opts.url).to.equal('http://1.2.3.4:987/keypress/Home');
                expect(opts.timeout).to.equal(1000);
                d.resolve();
            });
            await rokuDeploy.pressHomeButton('1.2.3.4', 987, 1000);
            await d.promise;
        });
    });

    let fileCounter = 1;
    describe('publish', () => {
        beforeEach(() => {
            options.host = '0.0.0.0';
            //rename the rokudeploy.json file so publish doesn't pick it up
            try {
                fsExtra.renameSync('rokudeploy.json', 'temp.rokudeploy.json');
            } catch (e) { }

            //make a dummy output file...we don't care what's in it
            options.outFile = `temp${fileCounter++}.zip`;
            try {
                fsExtra.mkdirSync(options.outDir);
            } catch (e) { }
            try {
                fsExtra.appendFileSync(`${options.outDir}/${options.outFile}`, 'asdf');
            } catch (e) { }
        });

        afterEach(() => {
            //rename the rokudeploy.json file so publish doesn't pick it up
            try {
                fsExtra.renameSync('temp.rokudeploy.json', 'rokudeploy.json');
            } catch (e) { }
        });

        it('does not delete the archive by default', async () => {
            let zipPath = `${options.outDir}/${options.outFile}`;

            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
            await rokuDeploy.publish(options);
            //the file should still exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
        });

        it('deletes the archive when configured', async () => {
            let zipPath = `${options.outDir}/${options.outFile}`;

            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
            await rokuDeploy.publish({ ...options, retainDeploymentArchive: false });
            //the file should not exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.false;
            //the out folder should also be deleted since it's empty
        });

        it('fails when the zip file is missing', async () => {
            options.outFile = 'fileThatDoesNotExist.zip';
            try {
                await rokuDeploy.publish(options);
                throw new Error('publish should have thrown an exception');
            } catch (e) {
                let zipFilePath = rokuDeploy.getOutputZipFilePath(options);
                expect(e.message).to.equal(`Cannot publish because file does not exist at '${zipFilePath}'`);
            }
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
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('handles successful deploy with remoteDebug', () => {
            options.failOnCompileError = true;
            options.remoteDebug = true;
            mockDoPostRequest();

            return rokuDeploy.publish(options).then((result) => {
                expect(result.message).to.equal('Successful deploy');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', () => {
            options.failOnCompileError = false;

            let body = 'Identical to previous version -- not replacing.';
            mockDoPostRequest(body);

            return rokuDeploy.publish(options).then((result) => {
                expect(result.results.body).to.equal(body);
            }, () => {
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
            const body = `<device-info>
                <keyed-developer-id>${options.devId}</keyed-developer-id>
            </device-info>`;
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
            await rokuDeploy.rekeyDevice(options);
        });

        it('should not return an error if dev ID is not set', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);
            options.devId = undefined;
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
            let stagingFolderPath = rokuDeploy.getOptions().stagingFolderPath;
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
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest'
                ]
            });
            expect(dir('out/.roku-deploy-staging')).to.exist;
        });

        it('should support overriding the staging folder', async () => {
            await rokuDeploy.prepublishToStaging({
                ...options,
                files: ['manifest'],
                stagingFolderPath: '.tmp/custom-out-dir'
            });
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
                    src: 'source/**/*',
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
            options.retainStagingFolder = true;
            await rokuDeploy.prepublishToStaging({
                ...options, files: [
                    'manifest',
                    'source',
                    'components/**/*',
                    '!components/scenes/**/*'
                ]
            });
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

        it('retains subfolder structure when referencing a folder', async () => {
            options.files = [
                'manifest',
                {
                    src: 'flavors/shared/resources/**/*',
                    dest: 'resources'
                }
            ];
            await rokuDeploy.prepublishToStaging(options);
            expect(file('out/.roku-deploy-staging/resources/images/fhd/image.jpg')).to.exist;
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
            let sourcePath = s`${cwd}/test.md`;
            let rootDir = s`${cwd}/.tmp/testProject`;
            let symlinkPath = s`${rootDir}/renamed_test.md`;

            beforeEach(cleanUp);
            afterEach(cleanUp);

            function cleanUp() {
                try {
                    fsExtra.removeSync(sourcePath);
                } catch (e) { }
                //delete the symlink if it exists
                try {
                    fsExtra.removeSync(symlinkPath);
                } catch (e) { }
            }

            let _isSymlinkingPermitted: boolean;

            /**
             * Determine if we have permission to create symlinks
             */
            function getIsSymlinksPermitted() {
                if (_isSymlinkingPermitted === undefined) {
                    fsExtra.ensureDirSync(`${tmpPath}/a/b/c`);
                    fsExtra.ensureDirSync(`${tmpPath}/project`);
                    fsExtra.writeFileSync(`${tmpPath}/a/alpha.txt`, 'alpha.txt');
                    fsExtra.writeFileSync(`${tmpPath}/a/b/c/charlie.txt`, 'charlie.txt');

                    try {
                        //make a file symlink
                        fsExtra.symlinkSync(`${tmpPath}/a/alpha.txt`, `${tmpPath}/project/alpha.txt`);
                        //create a folder symlink that also includes subfolders
                        fsExtra.symlinkSync(`${tmpPath}/a`, `${tmpPath}/project/a`);
                        //use glob to scan the directory recursively
                        glob.sync('**/*', {
                            cwd: s`${tmpPath}/project`,
                            absolute: true,
                            follow: true
                        });
                        _isSymlinkingPermitted = true;
                    } catch (e) {
                        _isSymlinkingPermitted = false;
                        return false;
                    }
                }
                return _isSymlinkingPermitted;
            }

            function symlinkIt(name, callback) {
                if (getIsSymlinksPermitted()) {
                    console.log(`symlinks are permitted for test "${name}"`);
                    it(name, callback);
                } else {
                    console.log(`symlinks are not permitted for test "${name}"`);
                    it.skip(name, callback);
                }
            }

            symlinkIt('direct symlinked files are dereferenced properly', async () => {
                //make sure the output dir exists
                await fsExtra.ensureDir(path.dirname(symlinkPath));
                //create the actual file
                await fsExtra.writeFile(sourcePath, 'hello symlink');

                //the source file should exist
                expect(file(sourcePath)).to.exist;

                //create the symlink in testProject
                await fsExtra.symlink(sourcePath, symlinkPath);

                //the symlink file should exist
                expect(file(symlinkPath)).to.exist;
                let opts = {
                    ...options,
                    rootDir: rootDir,
                    files: [
                        'manifest',
                        'renamed_test.md'
                    ]
                };

                let stagingFolderPath = rokuDeploy.getOptions(opts).stagingFolderPath;
                //getFilePaths detects the file
                expect(await rokuDeploy.getFilePaths(['renamed_test.md'], opts.rootDir)).to.eql([{
                    src: s`${opts.rootDir}/renamed_test.md`,
                    dest: s`renamed_test.md`
                }]);

                await rokuDeploy.prepublishToStaging(opts);
                let stagedFilePath = s`${stagingFolderPath}/renamed_test.md`;
                expect(file(stagedFilePath)).to.exist;
                let fileContents = await fsExtra.readFile(stagedFilePath);
                expect(fileContents.toString()).to.equal('hello symlink');
            });

            symlinkIt('copies files from subdirs of symlinked folders', async () => {
                fsExtra.ensureDirSync(s`${tmpPath}/baseProject/source/lib/promise`);
                fsExtra.writeFileSync(s`${tmpPath}/baseProject/source/lib/lib.brs`, `'lib.brs`);
                fsExtra.writeFileSync(s`${tmpPath}/baseProject/source/lib/promise/promise.brs`, `'q.brs`);

                fsExtra.ensureDirSync(s`${tmpPath}/mainProject/source`);
                fsExtra.writeFileSync(s`${tmpPath}/mainProject/source/main.brs`, `'main.brs`);

                //symlink the baseProject lib folder into the mainProject
                fsExtra.symlinkSync(s`${tmpPath}/baseProject/source/lib`, s`${tmpPath}/mainProject/source/lib`);

                //the symlinked file should exist in the main project
                expect(fsExtra.pathExistsSync(s`${tmpPath}/baseProject/source/lib/promise/promise.brs`)).to.be.true;

                let opts = {
                    ...options,
                    rootDir: s`${tmpPath}/mainProject`,
                    files: [
                        'manifest',
                        'source/**/*'
                    ]
                };

                let stagingPath = rokuDeploy.getOptions(opts).stagingFolderPath;
                //getFilePaths detects the file
                expect(
                    (await rokuDeploy.getFilePaths(opts.files, opts.rootDir)).sort((a, b) => a.src.localeCompare(b.src))
                ).to.eql([{
                    src: s`${tmpPath}/mainProject/source/lib/lib.brs`,
                    dest: s`source/lib/lib.brs`
                }, {
                    src: s`${tmpPath}/mainProject/source/lib/promise/promise.brs`,
                    dest: s`source/lib/promise/promise.brs`
                }, {
                    src: s`${tmpPath}/mainProject/source/main.brs`,
                    dest: s`source/main.brs`
                }]);

                await rokuDeploy.prepublishToStaging(opts);
                expect(fsExtra.pathExistsSync(`${stagingPath}/source/lib/promise/promise.brs`));
            });
        });
    });

    describe('normalizeFilesArray', () => {
        it('catches invalid dest entries', () => {
            expect(() => {
                rd.normalizeFilesArray([{
                    src: 'some/path',
                    dest: <any>true
                }]);
            }).to.throw();

            expect(() => {
                rd.normalizeFilesArray([{
                    src: 'some/path',
                    dest: <any>false
                }]);
            }).to.throw();

            expect(() => {
                rd.normalizeFilesArray([{
                    src: 'some/path',
                    dest: <any>/asdf/gi
                }]);
            }).to.throw();

            expect(() => {
                rd.normalizeFilesArray([{
                    src: 'some/path',
                    dest: <any>{}
                }]);
            }).to.throw();

            expect(() => {
                rd.normalizeFilesArray([{
                    src: 'some/path',
                    dest: <any>[]
                }]);
            }).to.throw();
        });

        it('normalizes directory separators paths', () => {
            expect(rd.normalizeFilesArray([{
                src: `long/source/path`,
                dest: `long/dest/path`
            }])).to.eql([{
                src: s`long/source/path`,
                dest: s`long/dest/path`
            }]);
        });
        it('works for simple strings', () => {
            expect(rd.normalizeFilesArray([
                'manifest',
                'source/main.brs'
            ])).to.eql([
                'manifest',
                'source/main.brs'
            ]);
        });

        it('works for negated strings', () => {
            expect(rd.normalizeFilesArray([
                '!.git'
            ])).to.eql([
                '!.git'
            ]);
        });

        it('skips falsey and bogus entries', () => {
            expect(rd.normalizeFilesArray([
                '',
                'manifest',
                <any>false,
                undefined,
                null
            ])).to.eql([
                'manifest'
            ]);
        });

        it('works for {src:string} objects', () => {
            expect(rd.normalizeFilesArray([
                {
                    src: 'manifest'
                }
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }]);
        });

        it('works for {src:string[]} objects', () => {
            expect(rd.normalizeFilesArray([
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
                src: s`source/main.brs`,
                dest: undefined
            }]);
        });

        it('retains dest option', () => {
            expect(rd.normalizeFilesArray([
                {
                    src: 'source/config.dev.brs',
                    dest: 'source/config.brs'
                }
            ])).to.eql([{
                src: s`source/config.dev.brs`,
                dest: s`source/config.brs`
            }]);
        });

        it('throws when encountering invalid entries', () => {
            expect(() => rd.normalizeFilesArray(<any>[true])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[/asdf/])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[new Date()])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[1])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[{ src: true }])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[{ src: /asdf/ }])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[{ src: new Date() }])).to.throw();
            expect(() => rd.normalizeFilesArray(<any>[{ src: 1 }])).to.throw();
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
                await rokuDeploy.zipFolder('source', '.tmp/some/zip/path/that/does/not/exist');
            });
        });

        it('allows modification of file contents with callback', async () => {
            const stageFolder = path.join(tmpPath, 'testProject');
            fsExtra.ensureDirSync(stageFolder);
            const files = [
                'components/components/Loader/Loader.brs',
                'images/splash_hd.jpg',
                'source/main.brs',
                'manifest'
            ];
            for (const file of files) {
                fsExtra.copySync(path.join(options.rootDir, file), path.join(stageFolder, file));
            }

            const outputZipPath = path.join(tmpPath, 'output.zip');
            const addedManifestLine = 'bs_libs_required=roku_ads_lib';
            await rokuDeploy.zipFolder(stageFolder, outputZipPath, (file, data) => {
                if (file.dest === 'manifest') {
                    let manifestContents = data.toString();
                    manifestContents += addedManifestLine;
                    data = Buffer.from(manifestContents, 'utf8');
                }
                return data;
            });

            const data = fsExtra.readFileSync(outputZipPath);
            const zip = await JSZip.loadAsync(data);
            for (const file of files) {
                const zipFileContents = await zip.file(file.toString()).async('string');
                const sourcePath = path.join(options.rootDir, file);
                const incomingContents = fsExtra.readFileSync(sourcePath, 'utf8');
                if (file === 'manifest') {
                    expect(zipFileContents).to.contain(addedManifestLine);
                } else {
                    expect(zipFileContents).to.equal(incomingContents);
                }
            }
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
            inputParsedManifest = rokuDeploy.parseManifestFromString(inputManifestContents);
        });

        it('correctly converts back to a valid manifest when lineNumber and keyIndexes are provided', () => {
            let outputStringifiedManifest = rokuDeploy.stringifyManifest(inputParsedManifest);
            let outputNormalized = outputStringifiedManifest.replace(/\r\n/g, '\n');
            let inputNormalized = inputManifestContents.replace(/\r\n/g, '\n');
            expect(outputNormalized).to.equal(inputNormalized);
        });

        it('correctly converts back to a valid manifest when lineNumber and keyIndexes are not provided', () => {
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

    describe('getFilePaths', () => {
        let tempPath = s`${cwd}/getFilePaths_temp`;
        let rootDir = s`${tempPath}/src`;
        let stagingPathAbsolute = s`${tmpPath}/staging`;
        let otherProjectDir = s`${tempPath}/otherProjectSrc`;

        //create baseline project structure
        before(() => {
            fsExtra.removeSync(tempPath);

            //srcSync
            fsExtra.ensureDirSync(`${rootDir}/source`);
            fsExtra.ensureDirSync(`${rootDir}/components/screen1`);
            fsExtra.ensureDirSync(`${rootDir}/components/emptyFolder`);
            fsExtra.writeFileSync(`${rootDir}/manifest`, '');
            fsExtra.writeFileSync(`${rootDir}/source/main.brs`, '');
            fsExtra.writeFileSync(`${rootDir}/source/lib.brs`, '');
            fsExtra.writeFileSync(`${rootDir}/components/component1.xml`, '');
            fsExtra.writeFileSync(`${rootDir}/components/component1.brs`, '');
            fsExtra.writeFileSync(`${rootDir}/components/screen1/screen1.xml`, '');
            fsExtra.writeFileSync(`${rootDir}/components/screen1/screen1.brs`, '');

            //otherProjectSrc
            fsExtra.ensureDirSync(`${otherProjectDir}/source`);
            fsExtra.writeFileSync(`${otherProjectDir}/manifest`, '');
            fsExtra.writeFileSync(`${otherProjectDir}/source/thirdPartyLib.brs`, '');
            fsExtra.ensureDirSync(`${otherProjectDir}/components/component1/subComponent`);
            fsExtra.writeFileSync(`${otherProjectDir}/components/component1/subComponent/screen.brs`, '');
        });

        after(async () => {
            await fsExtra.remove(tempPath);
        });

        async function getFilePaths(files: FileEntry[], rootDirOverride = rootDir) {
            return (await rokuDeploy.getFilePaths(files, rootDirOverride))
                .sort((a, b) => a.src.localeCompare(b.src));
        }

        describe('top-level-patterns', () => {
            it('works for root-level double star', async () => {
                expect(await getFilePaths([
                    '**/*'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                },
                {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                },
                {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                },
                {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('works for multile entries', async () => {
                expect(await getFilePaths([
                    'source/**/*',
                    'components/**/*',
                    'manifest'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }, {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                }, {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('copies top-level-string single-star globs', async () => {
                expect(await getFilePaths([
                    'source/*.brs'
                ])).to.eql([{
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('works for double-star globs', async () => {
                expect(await getFilePaths([
                    '**/*.brs'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('copies subdir-level relative double-star globs', async () => {
                expect(await getFilePaths([
                    'components/**/*.brs'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }]);
            });

            it('throws exception when top-level strings reference files not under rootDir', async () => {
                await expectThrowsAsync(async () => {
                    await getFilePaths([
                        `../otherProjectSrc/**/*`
                    ]);
                });
            });

            it('applies negated patterns', async () => {
                expect(await getFilePaths([
                    //include all components
                    'components/**/*.brs',
                    //exclude all xml files
                    '!components/**/*.xml',
                    //re-include a specific xml file
                    'components/screen1/screen1.xml'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }]);
            });

            it('handles negated multi-globs', async () => {
                expect((await getFilePaths([
                    'components/**/*',
                    '!components/screen1/**/*'
                ])).map(x => x.dest)).to.eql([
                    s`components/component1.brs`,
                    s`components/component1.xml`
                ]);
            });

            it('applies multi-glob paths relative to rootDir', async () => {
                expect(await getFilePaths([
                    'manifest',
                    'source/**/*',
                    'components/**/*',
                    '!components/scenes/**/*'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }, {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                }, {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('ignores non-glob folder paths', async () => {
                expect(await getFilePaths([
                    //this is the folder called "components"
                    'components'
                ])).to.eql([]); //there should be no matches because rokudeploy ignores folders
            });

        });

        describe('{src;dest} objects', () => {
            it('works for root-level double star', async () => {
                expect(await getFilePaths([{
                    src: '**/*',
                    dest: ''
                }
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                },
                {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                },
                {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                },
                {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('uses the root of staging folder for dest when not specified with star star', async () => {
                expect(await getFilePaths([{
                    src: `${otherProjectDir}/**/*`
                }])).to.eql([{
                    src: s`${otherProjectDir}/components/component1/subComponent/screen.brs`,
                    dest: s`components/component1/subComponent/screen.brs`
                }, {
                    src: s`${otherProjectDir}/manifest`,
                    dest: s`manifest`
                }, {
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`source/thirdPartyLib.brs`
                }]);
            });

            it('copies absolute path files to specified dest', async () => {
                expect(await getFilePaths([{
                    src: `${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: 'lib/thirdPartyLib.brs'
                }])).to.eql([{
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`lib/thirdPartyLib.brs`
                }]);
            });

            it('copies relative path files to specified dest', async () => {
                expect(await getFilePaths([{
                    src: `${otherProjectDir}/../src/source/main.brs`,
                    dest: 'source/main.brs'
                }])).to.eql([{
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('maintains relative path after **', async () => {
                expect(await getFilePaths([{
                    src: `../otherProjectSrc/**/*`,
                    dest: 'outFolder/'
                }])).to.eql([{
                    src: s`${otherProjectDir}/components/component1/subComponent/screen.brs`,
                    dest: s`outFolder/components/component1/subComponent/screen.brs`
                }, {
                    src: s`${otherProjectDir}/manifest`,
                    dest: s`outFolder/manifest`
                }, {
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`outFolder/source/thirdPartyLib.brs`
                }]);
            });

            it('works for other globs', async () => {
                expect(await getFilePaths([{
                    src: `components/screen1/*creen1.brs`,
                    dest: s`/source`
                }])).to.eql([{
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`source/screen1.brs`
                }]);
            });

            it('works for other globs without dest', async () => {
                expect(await getFilePaths([{
                    src: `components/screen1/*creen1.brs`
                }])).to.eql([{
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`screen1.brs`
                }]);
            });

            it('skips directory folder names for other globs without dest', async () => {
                expect(await getFilePaths([{
                    //straight wildcard matches folder names too
                    src: `components/*`
                }])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`component1.xml`
                }]);
            });

            it('applies negated patterns', async () => {
                expect(await getFilePaths([
                    //include all components
                    { src: 'components/**/*.brs', dest: 'components' },
                    //exclude all xml files
                    '!components/**/*.xml',
                    //re-include a specific xml file
                    { src: 'components/screen1/screen1.xml', dest: 'components/screen1/screen1.xml' }
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }]);
            });
        });

        it('converts relative rootDir path to absolute', async () => {
            let stub = sinon.stub(rokuDeploy, 'getOptions').callThrough();
            await getFilePaths([
                'source/main.brs'
            ], './rootDir');
            expect(stub.callCount).to.be.greaterThan(0);
            expect(stub.getCall(0).args[0].rootDir).to.eql('./rootDir');
            expect(stub.getCall(0).returnValue.rootDir).to.eql(s`${cwd}/rootDir`);
        });

        it('works when using a different current working directory than rootDir', async () => {
            let rootProjectDir = path.resolve(options.rootDir);

            //sanity check, make sure it works without fiddling with cwd intact
            let paths = (await rokuDeploy.getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ], rootProjectDir)).sort((a, b) => a.src.localeCompare(b.src));

            expect(paths).to.eql([{
                src: s`${rootProjectDir}/images/splash_hd.jpg`,
                dest: s`images/splash_hd.jpg`
            }, {
                src: s`${rootProjectDir}/manifest`,
                dest: s`manifest`
            }]);

            //change the working directory and verify everything still works

            let wrongCwd = path.dirname(path.resolve(options.rootDir));
            process.chdir(wrongCwd);

            paths = (await rokuDeploy.getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ], rootProjectDir)).sort((a, b) => a.src.localeCompare(b.src));

            expect(paths).to.eql([{
                src: s`${rootProjectDir}/images/splash_hd.jpg`,
                dest: s`images/splash_hd.jpg`
            }, {
                src: s`${rootProjectDir}/manifest`,
                dest: s`manifest`
            }]);
        });

        it('supports absolute paths from outside of the rootDir', async () => {
            options = rokuDeploy.getOptions(options);

            //dest not specified
            expect(await rokuDeploy.getFilePaths([{
                src: s`${cwd}/README.md`
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`README.md`
            }]);

            //dest specified
            expect(await rokuDeploy.getFilePaths([{
                src: path.join(cwd, 'README.md'),
                dest: 'docs/README.md'
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            let outDir = path.resolve(options.outDir);
            let paths: any[];

            paths = await rokuDeploy.getFilePaths([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }], outDir);

            expect(paths).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            //top-level string paths pointing to files outside the root should thrown an exception
            await expectThrowsAsync(async () => {
                paths = await rokuDeploy.getFilePaths([
                    s`${cwd}/README.md`
                ], outDir);
            });
        });

        it('supports relative paths that grab files from outside of the rootDir', async () => {
            let outDir = path.resolve(options.outDir);
            let rootProjectDir = path.resolve(options.rootDir);

            expect(await rokuDeploy.getFilePaths([{
                src: path.join('..', 'README.md')
            }], rootProjectDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`README.md`
            }]);

            expect(await rokuDeploy.getFilePaths([{
                src: path.join('..', 'README.md'),
                dest: 'docs/README.md'
            }], rootProjectDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            //should throw exception because we can't have top-level string paths pointed to files outside the root
            await expectThrowsAsync(async () => {
                let paths = await rokuDeploy.getFilePaths([
                    path.join('..', 'README.md')
                ], outDir);
            });
        });

        it('supports overriding paths', async () => {
            let paths = await rokuDeploy.getFilePaths([{
                src: s`${rootDir}/components/component1.brs`,
                dest: 'comp1.brs'
            }, {
                src: s`${rootDir}/components/screen1/screen1.brs`,
                dest: 'comp1.brs'
            }], rootDir);
            expect(paths).to.be.lengthOf(1);
            expect(s`${paths[0].src}`).to.equal(s`${rootDir}/components/screen1/screen1.brs`);
        });

        it('supports overriding paths from outside the root dir', async () => {
            let thisRootDir = s`${cwd}/tempTestOverrides/src`;
            try {

                fsExtra.ensureDirSync(s`${thisRootDir}/source`);
                fsExtra.ensureDirSync(s`${thisRootDir}/components`);
                fsExtra.ensureDirSync(s`${thisRootDir}/../.tmp`);

                fsExtra.writeFileSync(s`${thisRootDir}/source/main.brs`, '');
                fsExtra.writeFileSync(s`${thisRootDir}/components/MainScene.brs`, '');
                fsExtra.writeFileSync(s`${thisRootDir}/components/MainScene.xml`, '');
                fsExtra.writeFileSync(s`${thisRootDir}/../.tmp/MainScene.brs`, '');

                let files = [
                    '**/*.xml',
                    '**/*.brs',
                    {
                        src: '../.tmp/MainScene.brs',
                        dest: 'components/MainScene.brs'
                    }
                ];
                let paths = await rokuDeploy.getFilePaths(files, thisRootDir);

                //the MainScene.brs file from source should NOT be included
                let mainSceneEntries = paths.filter(x => s`${x.dest}` === s`components/MainScene.brs`);
                expect(
                    mainSceneEntries,
                    `Should only be one files entry for 'components/MainScene.brs'`
                ).to.be.lengthOf(1);
                expect(s`${mainSceneEntries[0].src}`).to.eql(s`${thisRootDir}/../.tmp/MainScene.brs`);
            } finally {
                //clean up
                await fsExtra.remove(s`${thisRootDir}/../`);
            }
        });
    });

    describe('getDestPath', () => {
        let rootDir = cwd;
        it('finds dest path for top-level path', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/components/comp1/comp1.brs`,
                    ['components/**/*'],
                    rootDir
                )
            ).to.equal(s`components/comp1/comp1.brs`);
        });

        it('does not find dest path for non-matched top-level path', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/source/main.brs`,
                    ['components/**/*'],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('excludes a file that is negated', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/source/main.brs`,
                    [
                        'source/**/*',
                        '!source/main.brs'
                    ],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('excludes a file that is negated in src;dest;', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/source/main.brs`,
                    [
                        'source/**/*',
                        {
                            src: '!source/main.brs'
                        }
                    ],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('works for brighterscript files', () => {
            let destPath = rokuDeploy.getDestPath(
                util.standardizePath(`${cwd}/src/source/main.bs`),
                [
                    'manifest',
                    'source/**/*.bs'
                ],
                s`${cwd}/src`
            );
            expect(s`${destPath}`).to.equal(s`source/main.bs`);
        });

        it('throws exception when rootDir is not absolute', () => {
            let stub = sinon.stub(rokuDeploy, 'getOptions').callThrough();
            let destPath = rokuDeploy.getDestPath(
                util.standardizePath(`${cwd}/src/source/main.bs`),
                [
                    'manifest',
                    'source/**/*.bs'
                ],
                `./src`
            );
            expect(stub.callCount).to.be.greaterThan(0);
            expect(stub.getCall(0).args[0].rootDir).to.eql('./src');
            expect(stub.getCall(0).returnValue.rootDir).to.eql(s`${cwd}/src`);
            expect(s`${destPath}`).to.equal(s`source/main.bs`);
        });

        it('excludes a file found outside the root dir', async () => {
            options = rokuDeploy.getOptions(options);
            let outDir = path.resolve(options.outDir);

            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/../source/main.brs`,
                    [
                        '../source/**/*'
                    ],
                    rootDir
                )
            ).to.be.undefined;

            let paths = await rokuDeploy.getFilePaths([{
                src: path.join('..', 'README.md'),
                dest: s`docs/README.md`
            }], outDir);

            expect(paths).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
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
            sinon.stub(rokuDeploy.fsExtra, 'ensureDir').callsFake(((pth: string, callback: (err: Error) => void) => {
                //do nothing, assume the dir gets created
            }) as any);

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
                        statusCode: 200
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

    describe('prepublishToStaging', () => {
        it('is resilient to file system errors', async () => {
            let copy = rokuDeploy.fsExtra.copy;
            let count = 0;

            //mock writeFile so we can throw a few errors during the test
            sinon.stub(rokuDeploy.fsExtra, 'copy').callsFake((...args) => {
                count += 1;
                //fail a few times
                if (count < 5) {
                    throw new Error('fake error thrown as part of the unit test');
                } else {
                    return copy.apply(rokuDeploy.fsExtra, args);
                }
            });

            let stagingFolderPath = rokuDeploy.getOptions().stagingFolderPath;

            //override the retry milliseconds to make test run faster
            let orig = util.tryRepeatAsync.bind(util);
            sinon.stub(util, 'tryRepeatAsync').callsFake(async (...args) => {
                return orig(args[0], args[1], 0);
            });

            await rokuDeploy.prepublishToStaging({
                stagingFolderPath: stagingFolderPath,
                files: [
                    'source/main.brs'
                ]
            });
            expect(file(s`${stagingFolderPath}/source/main.brs`)).to.exist;
            expect(count).to.be.greaterThan(4);
        });

        it('throws underlying error after the max fs error threshold is reached', async () => {
            let copy = rokuDeploy.fsExtra.copy;
            let count = 0;

            //mock writeFile so we can throw a few errors during the test
            sinon.stub(rokuDeploy.fsExtra, 'copy').callsFake((...args) => {
                count += 1;
                //fail a few times
                if (count < 15) {
                    throw new Error('fake error thrown as part of the unit test');
                } else {
                    return copy.apply(rokuDeploy.fsExtra, args);
                }
            });

            //override the timeout for tryRepeatAsync so this test runs faster
            let orig = util.tryRepeatAsync.bind(util);
            sinon.stub(util, 'tryRepeatAsync').callsFake(async (...args) => {
                return orig(args[0], args[1], 0);
            });

            let stagingFolderPath = rokuDeploy.getOptions().stagingFolderPath;

            let error: Error;
            try {
                await rokuDeploy.prepublishToStaging({
                    stagingFolderPath: stagingFolderPath,
                    files: [
                        'source/main.brs'
                    ]
                });
            } catch (e) {
                error = e;
            }
            expect(error, 'Should have thrown error').to.exist;
            expect(error.message).to.equal('fake error thrown as part of the unit test');
        });
    });

    describe('checkRequest', () => {
        it('throws FailedDeviceResponseError when necessary', () => {
            sinon.stub(rokuDeploy as any, 'getRokuMessagesFromResponseBody').returns({
                errors: ['a bad thing happened']
            } as any);
            let ex;
            try {
                rokuDeploy['checkRequest']({
                    response: {},
                    body: 'something bad!'
                });
            } catch (e) {
                ex = e;
            }
            expect(ex).to.be.instanceof(errors.FailedDeviceResponseError);
        });
    });

    describe('getOptions', () => {
        it('calling with no parameters works', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            let options = rokuDeploy.getOptions(undefined);
            expect(options.stagingFolderPath).to.exist;
        });

        it('calling with empty param object', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            let options = rokuDeploy.getOptions({});
            expect(options.stagingFolderPath).to.exist;
        });

        it('works when passing in stagingFolderPath', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            let options = rokuDeploy.getOptions({
                stagingFolderPath: './staging-dir'
            });
            expect(options.stagingFolderPath.endsWith('staging-dir')).to.be.true;
        });

        it('works when loading stagingFolderPath from rokudeploy.json', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return true;
            });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                {
                    "stagingFolderPath": "./staging-dir"
                }
            `);
            let options = rokuDeploy.getOptions();
            expect(options.stagingFolderPath.endsWith('staging-dir')).to.be.true;
        });

        it('supports jsonc for roku-deploy.json', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return (filePath as string).endsWith('rokudeploy.json');
            });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                //leading comment
                {
                    //inner comment
                    "rootDir": "src" //trailing comment
                }
                //trailing comment
            `);
            let options = rokuDeploy.getOptions(undefined);
            expect(options.rootDir).to.equal(path.join(process.cwd(), 'src'));
        });

        it('supports jsonc for bsconfig.json', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return (filePath as string).endsWith('bsconfig.json');
            });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                //leading comment
                {
                    //inner comment
                    "rootDir": "src" //trailing comment
                }
                //trailing comment
            `);
            let options = rokuDeploy.getOptions(undefined);
            expect(options.rootDir).to.equal(path.join(process.cwd(), 'src'));
        });

        it('catches invalid json with jsonc parser', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return (filePath as string).endsWith('bsconfig.json');
            });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                {
                    "rootDir": "src"
            `);
            let ex;
            try {
                let options = rokuDeploy.getOptions(undefined);
            } catch (e) {
                ex = e;
            }
            expect(ex).to.exist;
            expect(ex.message.startsWith('Error parsing')).to.be.true;
        });

        it('does not error when no parameter provided', () => {
            expect(rokuDeploy.getOptions(undefined)).to.exist;
        });

        describe('packagePort', () => {
            it('defaults to 80', () => {
                expect(rokuDeploy.getOptions({}).packagePort).to.equal(80);
            });
            it('can be overridden', () => {
                expect(rokuDeploy.getOptions({ packagePort: 95 }).packagePort).to.equal(95);
            });
        });

        describe('remotePort', () => {
            it('defaults to 8060', () => {
                expect(rokuDeploy.getOptions({}).remotePort).to.equal(8060);
            });
            it('can be overridden', () => {
                expect(rokuDeploy.getOptions({ remotePort: 1234 }).remotePort).to.equal(1234);
            });
        });

        describe('config file', () => {
            const rokudeployPath = 'rokudeploy.json';
            const tempRokudeployPath = 'temp.rokudeploy.json';
            const bsconfigPath = 'bsconfig.json';

            beforeEach(() => {
                try {
                    fsExtra.renameSync(rokudeployPath, tempRokudeployPath);
                } catch (e) { }
            });

            afterEach(() => {
                try {
                    fsExtra.removeSync(rokudeployPath);
                    fsExtra.removeSync(bsconfigPath);
                    fsExtra.renameSync(tempRokudeployPath, rokudeployPath);
                } catch (e) { }
            });

            it('if no config file is available it should use the default values', () => {
                expect(rokuDeploy.getOptions({}).outFile).to.equal('roku-deploy');
            });

            it('if rokudeploy.json config file is available it should use those values instead of the default', () => {
                const expectedOutFile = 'expectedOutFile';
                fsExtra.writeJsonSync(rokudeployPath, {
                    outFile: expectedOutFile
                });
                expect(rokuDeploy.getOptions({}).outFile).to.equal(expectedOutFile);
            });

            it('if bsconfig.json config file is available it should use those values instead of the default', () => {
                const expectedOutFile = 'expectedOutFile';
                fsExtra.writeJsonSync(bsconfigPath, {
                    outFile: expectedOutFile
                });
                expect(rokuDeploy.getOptions({}).outFile).to.equal(expectedOutFile);
            });

            it('if rokudeploy.json config file is available and bsconfig.json is also available it should use rokudeploy.json instead of bsconfig.json', () => {
                fsExtra.writeJsonSync(bsconfigPath, {
                    outFile: 'bsconfigOutFile'
                });
                const expectedOutFile = 'rokudeployOutFile';
                fsExtra.writeJsonSync(rokudeployPath, {
                    outFile: expectedOutFile
                });
                expect(rokuDeploy.getOptions({}).outFile).to.equal(expectedOutFile);
            });

            it('if run time options are provided they should override any existing config file options', () => {
                fsExtra.writeJsonSync(bsconfigPath, {
                    outFile: 'bsconfigOutFile'
                });
                fsExtra.writeJsonSync(rokudeployPath, {
                    outFile: 'rokudeployOutFile'
                });
                const options = {
                    outFile: 'runTimeOutFile'
                };
                expect(rokuDeploy.getOptions(options).outFile).to.equal(options.outFile);
            });

            it('if run time config is provided it should override any existing config file options', () => {
                fsExtra.writeJsonSync(rokudeployPath, {
                    outFile: 'rokudeployOutFile'
                });
                fsExtra.writeJsonSync(bsconfigPath, {
                    outFile: 'bsconfigOutFile'
                });

                const projectPath = 'brsconfig.json';
                const expectedOutFile = 'projectConfigOutFile';
                fsExtra.writeJsonSync(projectPath, {
                    outFile: expectedOutFile
                });
                const options = {
                    project: projectPath
                };
                expect(rokuDeploy.getOptions(options).outFile).to.equal(expectedOutFile);
                fsExtra.removeSync(projectPath);
            });
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
            f = () => {
                throw e;
            };
        } finally {
            assert.throws(f);
        }
    }
});

async function expectThrowsAsync(callback: () => Promise<any>, message = 'Expected to throw but did not') {
    let wasExceptionThrown = false;
    try {
        await callback();
    } catch (e) {
        wasExceptionThrown = true;
    }
    if (wasExceptionThrown === false) {
        throw new Error(message);
    }
}

function getFakeResponseBody(messages: string): string {
    return `<html>
        <head>
        <meta charset="utf-8">
        <meta name="HandheldFriendly" content="True">
        <title> Roku Development Kit </title>

        <link rel="stylesheet" type="text/css" media="screen" href="css/global.css" />
        </head>
        <body>
        <div id="root" style="background: #fff">


        </div>

        <!-- Keep it, so old scripts can continue to work -->
        <div style="display:none">
            <font color="red">Failure: Form Error: "archive" Field Not Found
        </font>
            <font color="red"></font>
            <p><font face="Courier">f1338f071efb2ff0f50824a00be3402a <br /> zip file in internal memory (3704254 bytes)</font></p>
        </div>

        <script type="text/javascript" src="css/global.js"></script>
        <script type="text/javascript">

            // Include core components and resounce bundle (needed)
            Shell.resource.set(null, {
                endpoints: {}
            });
            Shell.create('Roku.Event.Key');
            Shell.create('Roku.Events.Resize');
            Shell.create('Roku.Events.Scroll');

            // Create global navigation and render it
            var nav = Shell.create('Roku.Nav')
                .trigger('Enable standalone and utility mode - hide user menu, shopping cart, and etc.')
                .trigger('Use compact footer')
                .trigger('Hide footer')
                .trigger('Render', document.getElementById('root'))
                // Create custom links
                .trigger('Remove all feature links from header')
                .trigger('Add feature link in header', {
                    text: 'Installer',
                    url: 'plugin_install'
                })
                .trigger('Add feature link in header', {
                    text: 'Utilities',
                    url: 'plugin_inspect'
                })

                .trigger('Add feature link in header', { text: 'Packager', url: 'plugin_package' });

            // Retrieve main content body node
            var node = nav.invoke('Get main body section mounting node');

            // Create page container and page header
            var container = Shell.create('Roku.Nav.Page.Standard').trigger('Render', node);
            node = container.invoke('Get main body node');
            container.invoke('Get headline node').innerHTML = 'Development Application Installer';

            node.innerHTML = '<p>Currently Installed Application:</p><p><font face="Courier">f1338f071efb2ff0f50824a00be3402a <br /> zip file in internal memory (3704254 bytes)</font></p>';

            // Set up form in main body content area
            form = Shell.create('Roku.Form')
                .trigger('Set form action URL', 'plugin_install')
                .trigger('Set form encryption type to multi-part')
                .trigger("Add file upload button", {
                    name: "archive",
                    label: "File:"
                })
                .trigger("Add hidden input field", {
                    name: "mysubmit"
            });

            // Render some buttons
            var Delete = document.createElement('BUTTON');
            Delete.className = 'roku-button';
            Delete.innerHTML = 'Delete';
            Delete.onclick = function() {
                form.trigger('Update input field value', { name: 'mysubmit', value: 'Delete'})
                form.trigger('Force submit');
            };
            node.appendChild(Delete);

            if (true)
            {
                // Render some buttons
                var convert = document.createElement('BUTTON');
                convert.className = 'roku-button';
                convert.innerHTML = 'Convert to cramfs';
                convert.onclick = function() {
                    form.trigger('Update input field value', { name: 'mysubmit', value: 'Convert to cramfs'})
                    form.trigger('Force submit');
                };
                node.appendChild(convert);

                var convert2 = document.createElement('BUTTON');
                convert2.className = 'roku-button';
                convert2.innerHTML = 'Convert to squashfs';
                convert2.onclick = function() {
                    form.trigger('Update input field value', { name: 'mysubmit', value: 'Convert to squashfs'})
                    form.trigger('Force submit');
                };
                node.appendChild(convert2);
            }

            var hrDiv = document.createElement('div');
            hrDiv.innerHTML = '<hr />';
            node.appendChild(hrDiv);

            form.trigger('Render', node);

            // Render some buttons
            var submit = document.createElement('BUTTON');
            submit.className = 'roku-button';
            submit.innerHTML = 'Replace';
            submit.onclick = function() {
                form.trigger('Update input field value', { name: 'mysubmit', value: 'replace'})
                if(form.invoke('Validate and get input values').valid === true) {
                    form.trigger('Force submit');
                }
            };
            node.appendChild(submit);

            var d = document.createElement('div');
            d.innerHTML = '<br />';
            node.appendChild(d);

            // Reder messages (info, error, and success)\n${messages}



        </script>

        </body>
    </html>`;
}
