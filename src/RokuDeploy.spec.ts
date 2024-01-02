import * as assert from 'assert';
import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import type { WriteStream, PathLike } from 'fs-extra';
import * as fs from 'fs';
import * as q from 'q';
import * as path from 'path';
import * as JSZip from 'jszip';
import * as child_process from 'child_process';
import * as glob from 'glob';
import type { BeforeZipCallbackInfo } from './RokuDeploy';
import { RokuDeploy } from './RokuDeploy';
import * as errors from './Errors';
import { util, standardizePath as s, standardizePathPosix as sp } from './util';
import type { FileEntry, RokuDeployOptions } from './RokuDeployOptions';
import { cwd, expectPathExists, expectPathNotExists, expectThrowsAsync, outDir, rootDir, stagingDir, tempDir, writeFiles } from './testUtils.spec';
import { createSandbox } from 'sinon';
import * as r from 'postman-request';
import type * as requestType from 'request';
const request = r as typeof requestType;

const sinon = createSandbox();

describe('index', () => {
    let rokuDeploy: RokuDeploy;
    let options: RokuDeployOptions;

    let writeStreamPromise: Promise<WriteStream>;
    let writeStreamDeferred: q.Deferred<WriteStream> & { isComplete: undefined | true };
    let createWriteStreamStub: sinon.SinonStub;

    beforeEach(() => {
        rokuDeploy = new RokuDeploy();
        options = rokuDeploy.getOptions({
            rootDir: rootDir,
            outDir: outDir,
            devId: 'abcde',
            stagingDir: stagingDir,
            signingPassword: '12345',
            host: 'localhost',
            rekeySignedPackage: `${tempDir}/testSignedPackage.pkg`
        });
        options.rootDir = rootDir;
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        fsExtra.ensureDirSync(outDir);
        fsExtra.ensureDirSync(stagingDir);
        //most tests depend on a manifest file existing, so write an empty one
        fsExtra.outputFileSync(`${rootDir}/manifest`, '');

        writeStreamDeferred = q.defer<WriteStream>() as any;
        writeStreamPromise = writeStreamDeferred.promise as any;

        //fake out the write stream function
        createWriteStreamStub = sinon.stub(rokuDeploy.fsExtra, 'createWriteStream').callsFake((filePath: PathLike) => {
            const writeStream = fs.createWriteStream(filePath);
            writeStreamDeferred.resolve(writeStream);
            writeStreamDeferred.isComplete = true;
            return writeStream;
        });
    });

    afterEach(() => {
        if (createWriteStreamStub.called && !writeStreamDeferred.isComplete) {
            writeStreamDeferred.reject('Deferred was never resolved...so rejecting in the afterEach');
        }

        sinon.restore();
        //restore the original working directory
        process.chdir(cwd);
        //delete all temp files
        fsExtra.emptyDirSync(tempDir);
    });

    after(() => {
        fsExtra.removeSync(tempDir);
    });

    describe('getOutputPkgFilePath', () => {
        it('should return correct path if given basename', () => {
            let outputPath = rokuDeploy.getOutputPkgFilePath({
                outFile: 'roku-deploy',
                outDir: outDir
            });
            expect(outputPath).to.equal(path.join(path.resolve(outDir), options.outFile + '.pkg'));
        });

        it('should return correct path if given outFile option ending in .zip', () => {
            let outputPath = rokuDeploy.getOutputPkgFilePath({
                outFile: 'roku-deploy.zip',
                outDir: outDir
            });
            expect(outputPath).to.equal(path.join(path.resolve(outDir), 'roku-deploy.pkg'));
        });
    });

    describe('getOutputZipFilePath', () => {
        it('should return correct path if given basename', () => {
            let outputPath = rokuDeploy.getOutputZipFilePath({
                outFile: 'roku-deploy',
                outDir: outDir
            });
            expect(outputPath).to.equal(path.join(path.resolve(outDir), 'roku-deploy.zip'));
        });

        it('should return correct path if given outFile option ending in .zip', () => {
            let outputPath = rokuDeploy.getOutputZipFilePath({
                outFile: 'roku-deploy.zip',
                outDir: outDir
            });
            expect(outputPath).to.equal(path.join(path.resolve(outDir), 'roku-deploy.zip'));
        });
    });

    describe('doPostRequest', () => {
        it('should not throw an error for a successful request', async () => {
            let body = 'responseBody';
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            let results = await rokuDeploy['doPostRequest']({}, true);
            expect(results.body).to.equal(body);
        });

        it('should throw an error for a network error', async () => {
            let error = new Error('Network Error');
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, error);
                return {} as any;
            });

            try {
                await rokuDeploy['doPostRequest']({}, true);
            } catch (e) {
                expect(e).to.equal(error);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw an error for a wrong response code if verify is true', async () => {
            let body = 'responseBody';
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 500 }, body);
                return {} as any;
            });

            try {
                await rokuDeploy['doPostRequest']({}, true);
            } catch (e) {
                expect(e).to.be.instanceof(errors.InvalidDeviceResponseCodeError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should not throw an error for a response code if verify is false', async () => {
            let body = 'responseBody';
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 500 }, body);
                return {} as any;
            });

            let results = await rokuDeploy['doPostRequest']({}, false);
            expect(results.body).to.equal(body);
        });
    });

    describe('doGetRequest', () => {
        it('should not throw an error for a successful request', async () => {
            let body = 'responseBody';
            sinon.stub(request, 'get').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            let results = await rokuDeploy['doGetRequest']({} as any);
            expect(results.body).to.equal(body);
        });

        it('should throw an error for a network error', async () => {
            let error = new Error('Network Error');
            sinon.stub(request, 'get').callsFake((_, callback) => {
                process.nextTick(callback, error);
                return {} as any;
            });

            try {
                await rokuDeploy['doGetRequest']({} as any);
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
                errors: ['Failure: Form Error: "archive" Field Not Found'],
                infos: ['Some random info message'],
                successes: ['Screenshot ok']
            });
        });

        it('pull many messages from the response body including json messages', () => {
            let body = getFakeResponseBody(`
            Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'info').trigger('Set message content', 'Some random info message').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);

            var params = JSON.parse('{"messages":[{"text":"Application Received: 2500809 bytes stored.","text_type":"text","type":"success"},{"text":"Install Failure: Error parsing XML component SupportedFeaturesView.xml","text_type":"text","type":"error"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Screenshot ok","text_type":"text","type":"success"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            `);

            let results = rokuDeploy['getRokuMessagesFromResponseBody'](body);
            expect(results).to.eql({
                errors: ['Failure: Form Error: "archive" Field Not Found', 'Install Failure: Error parsing XML component SupportedFeaturesView.xml'],
                infos: ['Some random info message'],
                successes: ['Screenshot ok', 'Application Received: 2500809 bytes stored.']
            });
        });

        it('pull many messages from the response body including json messages and dedupe them', () => {
            let bodyOne = getFakeResponseBody(`
            Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'info').trigger('Set message content', 'Some random info message').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'info').trigger('Set message content', 'Some random info message').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);
            Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Failure: Form Error: "archive" Field Not Found').trigger('Render', node);

            var params = JSON.parse('{"messages":[{"text":"Application Received: 2500809 bytes stored.","text_type":"text","type":"success"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Application Received: 2500809 bytes stored.","text_type":"text","type":"success"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Install Failure: Error parsing XML component SupportedFeaturesView.xml","text_type":"text","type":"error"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Install Failure: Error parsing XML component SupportedFeaturesView.xml","text_type":"text","type":"error"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Some random info message","text_type":"text","type":"info"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Some random info message","text_type":"text","type":"info"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"wont be added","text_type":"text","type":"unknown"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"doesn't look like a roku message","text_type":"text"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"doesn't look like a roku message","type":"info"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"type":"info"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('[]');
            `);

            let resultsOne = rokuDeploy['getRokuMessagesFromResponseBody'](bodyOne);
            expect(resultsOne).to.eql({
                errors: ['Failure: Form Error: "archive" Field Not Found', 'Install Failure: Error parsing XML component SupportedFeaturesView.xml'],
                infos: ['Some random info message'],
                successes: ['Screenshot ok', 'Application Received: 2500809 bytes stored.']
            });

            let bodyTwo = getFakeResponseBody(`
            var params = JSON.parse('{"messages":[{"text":"Application Received: 2500809 bytes stored.","text_type":"text","type":"success"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Application Received: 2500809 bytes stored.","text_type":"text","type":"success"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Install Failure: Error parsing XML component SupportedFeaturesView.xml","text_type":"text","type":"error"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Install Failure: Error parsing XML component SupportedFeaturesView.xml","text_type":"text","type":"error"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Some random info message","text_type":"text","type":"info"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"messages":[{"text":"Some random info message","text_type":"text","type":"info"}],"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            var params = JSON.parse('{"metadata":{"dev_id":"123456789","dev_key":true,"voice_sdk":false},"packages":[]}');
            `);

            let resultsTwo = rokuDeploy['getRokuMessagesFromResponseBody'](bodyTwo);
            expect(resultsTwo).to.eql({
                errors: ['Install Failure: Error parsing XML component SupportedFeaturesView.xml'],
                infos: ['Some random info message'],
                successes: ['Application Received: 2500809 bytes stored.']
            });
        });
    });

    describe('getDeviceInfo', () => {
        const body = `<device-info>
            <udn>29380007-0800-1025-80a4-d83154332d7e</udn>
            <serial-number>123</serial-number>
            <device-id>456</device-id>
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
            <keyed-developer-id>789</keyed-developer-id>
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
            <av-sync-calibration-enabled>3.0</av-sync-calibration-enabled>
            <davinci-version>2.8.20</davinci-version>
            <brightscript-debugger-version>3.2.0</brightscript-debugger-version>
            <has-hands-free-voice-remote>false</has-hands-free-voice-remote>
            <mobile-has-live-tv>true</mobile-has-live-tv>
            <network-name>Plumb-5G</network-name>
            <supports-airplay>true</supports-airplay>
            <supports-audio-settings>false</supports-audio-settings>
            <ui-resolution>1080p</ui-resolution>
        </device-info>`;

        it('should return device info matching what was returned by ECP', async () => {
            mockDoGetRequest(body);
            const deviceInfo = await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
            expect(deviceInfo['serial-number']).to.equal('123');
            expect(deviceInfo['device-id']).to.equal('456');
            expect(deviceInfo['keyed-developer-id']).to.equal('789');
        });

        it('should default to port 8060 if not provided', async () => {
            const stub = mockDoGetRequest(body);
            await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
            expect(stub.getCall(0).args[0].url).to.eql('http://1.1.1.1:8060/query/device-info');
        });

        it('should use given port if provided', async () => {
            const stub = mockDoGetRequest(body);
            await rokuDeploy.getDeviceInfo({ host: '1.1.1.1', remotePort: 9999 });
            expect(stub.getCall(0).args[0].url).to.eql('http://1.1.1.1:9999/query/device-info');
        });


        it('does not crash when sanitizing fields that are not defined', async () => {
            mockDoGetRequest(`
                <device-info>
                    <udn>29380007-0800-1025-80a4-d83154332d7e</udn>
                </device-info>
                `);
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10', remotePort: 8060, enhance: true });
            expect(result.isStick).not.to.exist;
        });

        it('returns kebab-case by default', async () => {
            mockDoGetRequest(`
                <device-info>
                    <has-mobile-screensaver>true</has-mobile-screensaver>
                </device-info>
                `);
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10' });
            expect(result['has-mobile-screensaver']).to.eql('true');
        });

        it('should sanitize additional data when the host+param+format signature is triggered', async () => {
            mockDoGetRequest(body);
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10', remotePort: 8060, enhance: true });
            expect(result).to.include({
                // make sure the number fields are turned into numbers
                softwareBuild: 4170,
                uptime: 19799,
                trcVersion: 3.0,
                timeZoneOffset: -240,

                // string booleans should be turned into booleans
                isTv: false,
                isStick: false,
                supportsEthernet: true,
                hasWifiExtender: false,
                hasWifi5GSupport: true,
                secureDevice: true,
                timeZoneAuto: true,
                supportsSuspend: false,
                supportsFindRemote: true,
                findRemoteIsPossible: true,
                supportsAudioGuide: true,
                supportsRva: true,
                developerEnabled: true,
                searchEnabled: true,
                searchChannelsEnabled: true,
                voiceSearchEnabled: true,
                notificationsEnabled: true,
                notificationsFirstUse: false,
                supportsPrivateListening: true,
                headphonesConnected: false,
                supportsEcsTextedit: true,
                supportsEcsMicrophone: true,
                supportsWakeOnWlan: false,
                hasPlayOnRoku: true,
                hasMobileScreensaver: true
            });
        });

        it('converts keys to camel case when enabled', async () => {
            mockDoGetRequest(body);
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10', remotePort: 8060, enhance: true });
            const props = [
                'udn',
                'serialNumber',
                'deviceId',
                'advertisingId',
                'vendorName',
                'modelName',
                'modelNumber',
                'modelRegion',
                'isTv',
                'isStick',
                'mobileHasLiveTv',
                'uiResolution',
                'supportsEthernet',
                'wifiMac',
                'wifiDriver',
                'hasWifiExtender',
                'hasWifi5GSupport',
                'canUseWifiExtender',
                'ethernetMac',
                'networkType',
                'networkName',
                'friendlyDeviceName',
                'friendlyModelName',
                'defaultDeviceName',
                'userDeviceName',
                'userDeviceLocation',
                'buildNumber',
                'softwareVersion',
                'softwareBuild',
                'secureDevice',
                'language',
                'country',
                'locale',
                'timeZoneAuto',
                'timeZone',
                'timeZoneName',
                'timeZoneTz',
                'timeZoneOffset',
                'clockFormat',
                'uptime',
                'powerMode',
                'supportsSuspend',
                'supportsFindRemote',
                'findRemoteIsPossible',
                'supportsAudioGuide',
                'supportsRva',
                'hasHandsFreeVoiceRemote',
                'developerEnabled',
                'keyedDeveloperId',
                'searchEnabled',
                'searchChannelsEnabled',
                'voiceSearchEnabled',
                'notificationsEnabled',
                'notificationsFirstUse',
                'supportsPrivateListening',
                'headphonesConnected',
                'supportsAudioSettings',
                'supportsEcsTextedit',
                'supportsEcsMicrophone',
                'supportsWakeOnWlan',
                'supportsAirplay',
                'hasPlayOnRoku',
                'hasMobileScreensaver',
                'supportUrl',
                'grandcentralVersion',
                'trcVersion',
                'trcChannelVersion',
                'davinciVersion',
                'avSyncCalibrationEnabled',
                'brightscriptDebuggerVersion'
            ];
            expect(
                Object.keys(result).sort()
            ).to.eql(
                props.sort()
            );
        });

        it('should throw our error on failure', async () => {
            mockDoGetRequest();
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnparsableDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('normalizeDeviceInfoFieldValue', () => {
        it('converts normal values', () => {
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('true')).to.eql(true);
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('false')).to.eql(false);
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('1')).to.eql(1);
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('1.2')).to.eql(1.2);
            //it'll trim whitespace too
            expect(rokuDeploy.normalizeDeviceInfoFieldValue(' 1.2')).to.eql(1.2);
            expect(rokuDeploy.normalizeDeviceInfoFieldValue(' 1.2 ')).to.eql(1.2);
        });

        it('leaves invalid numbers as strings', () => {
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('v1.2.3')).to.eql('v1.2.3');
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('1.2.3-alpha.1')).to.eql('1.2.3-alpha.1');
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('123Four')).to.eql('123Four');
        });

        it('decodes HTML entities', () => {
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('3&4')).to.eql('3&4');
            expect(rokuDeploy.normalizeDeviceInfoFieldValue('3&amp;4')).to.eql('3&4');
        });
    });


    describe('getDevId', () => {
        it('should return the current Dev ID if successful', async () => {
            const expectedDevId = 'expectedDevId';
            const body = `<device-info>
                <keyed-developer-id>${expectedDevId}</keyed-developer-id>
            </device-info>`;
            mockDoGetRequest(body);
            let devId = await rokuDeploy.getDevId({
                host: '1.2.3.4'
            });
            expect(devId).to.equal(expectedDevId);
        });
    });

    describe('copyToStaging', () => {
        it('throws exceptions when rootDir does not exist', async () => {
            await expectThrowsAsync(
                rokuDeploy['copyToStaging']([], 'staging', 'folder_does_not_exist')
            );
        });

        it('throws exceptions on missing stagingPath', async () => {
            await expectThrowsAsync(
                rokuDeploy['copyToStaging']([], undefined, undefined)
            );
        });

        it('throws exceptions on missing rootDir', async () => {
            await expectThrowsAsync(
                rokuDeploy['copyToStaging']([], 'asdf', undefined)
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
                copyPaths.push({ src: src as string, dest: dest as string });
                return Promise.resolve();
            });

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

            await rokuDeploy['copyToStaging']([], stagingDir, rootDir);

            expect(ensureDirPaths).to.eql([
                s`${stagingDir}/source`,
                s`${stagingDir}/components/a/b/c`
            ]);

            expect(copyPaths).to.eql([
                {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`${stagingDir}/source/main.brs`
                }, {
                    src: s`${rootDir}/components/a/b/c/comp1.xml`,
                    dest: s`${stagingDir}/components/a/b/c/comp1.xml`
                }
            ]);
        });
    });

    describe('zipPackage', () => {
        it('should throw error when manifest is missing', async () => {
            let err;
            try {
                fsExtra.ensureDirSync(options.stagingDir);
                await rokuDeploy.zipPackage({
                    stagingDir: s`${tempDir}/path/to/nowhere`,
                    outDir: outDir
                });
            } catch (e) {
                err = (e as Error);
            }
            expect(err?.message.startsWith('Cannot zip'), `Unexpected error message: "${err.message}"`).to.be.true;
        });

        it('should throw error when manifest is missing and stagingDir does not exist', async () => {
            let err;
            try {
                await rokuDeploy.zipPackage({
                    stagingDir: s`${tempDir}/path/to/nowhere`,
                    outDir: outDir
                });
            } catch (e) {
                err = (e as Error);
            }
            expect(err).to.exist;
            expect(err.message.startsWith('Cannot zip'), `Unexpected error message: "${err.message}"`).to.be.true;
        });

    });

    describe('createPackage', () => {
        it('works with custom stagingDir', async () => {
            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: '.tmp/dist',
                outDir: outDir,
                rootDir: rootDir
            });
            expectPathExists(rokuDeploy.getOutputZipFilePath({ outDir: outDir }));
        });

        it('should throw error when no files were found to copy', async () => {
            await assertThrowsAsync(async () => {
                await rokuDeploy.createPackage({
                    files: [],
                    stagingDir: stagingDir,
                    outDir: outDir,
                    rootDir: rootDir
                });
            });
        });

        it('should create package in proper directory', async () => {
            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir
            });
            expectPathExists(rokuDeploy.getOutputZipFilePath({ outDir: outDir }));
        });

        it('should only include the specified files', async () => {
            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir
            });
            const data = fsExtra.readFileSync(rokuDeploy.getOutputZipFilePath({ outDir: outDir }));
            const zip = await JSZip.loadAsync(data);

            const files = ['manifest'];
            for (const file of files) {
                const zipFileContents = await zip.file(file.toString()).async('string');
                const sourcePath = path.join(options.rootDir, file);
                const incomingContents = fsExtra.readFileSync(sourcePath, 'utf8');
                expect(zipFileContents).to.equal(incomingContents);
            }
        });

        it('generates full package with defaults', async () => {
            const filePaths = writeFiles(rootDir, [
                'components/components/Loader/Loader.brs',
                'images/splash_hd.jpg',
                'source/main.brs',
                'manifest'
            ]);
            await rokuDeploy.createPackage({
                files: filePaths,
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir
            });

            const data = fsExtra.readFileSync(rokuDeploy.getOutputZipFilePath({ outDir: outDir }));
            const zip = await JSZip.loadAsync(data);

            for (const file of filePaths) {
                const zipFileContents = await zip.file(file.toString())?.async('string');
                const sourcePath = path.join(options.rootDir, file);
                const incomingContents = fsExtra.readFileSync(sourcePath, 'utf8');
                expect(zipFileContents).to.equal(incomingContents);
            }
        });

        it('should retain the staging directory when told to', async () => {
            let stagingDirValue = await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                rootDir: rootDir
            });
            expectPathExists(stagingDirValue);
            await rokuDeploy.zipPackage({
                stagingDir: stagingDir,
                retainStagingDir: true,
                outDir: outDir
            });
            expectPathExists(stagingDirValue);
        });

        it('should call our callback with correct information', async () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, 'major_version=1');

            let spy = sinon.spy((info: BeforeZipCallbackInfo) => {
                expectPathExists(info.stagingDir);
                expect(info.manifestData.major_version).to.equal('1');
            });

            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir
            }, spy);

            if (spy.notCalled) {
                assert.fail('Callback not called');
            }
        });

        it('should wait for promise returned by pre-zip callback', async () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, '');
            let count = 0;
            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir
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
            fsExtra.outputFileSync(`${rootDir}/manifest`, `build_version=0`);
            //make the zipping immediately resolve
            sinon.stub(rokuDeploy, 'zipPackage').returns(Promise.resolve());
            let beforeZipInfo: BeforeZipCallbackInfo;
            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir,
                incrementBuildNumber: true
            }, (info) => {
                beforeZipInfo = info;
            });
            expect(beforeZipInfo.manifestData.build_version).to.not.equal('0');
        });

        it('should not increment the build number if not requested', async () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, `build_version=0`);
            await rokuDeploy.createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: stagingDir,
                outDir: outDir,
                rootDir: rootDir,
                incrementBuildNumber: false
            }, (info) => {
                expect(info.manifestData.build_version).to.equal('0');
            });
        });
    });

    it('runs via the command line using the rokudeploy.json file', function test() {
        this.timeout(20000);
        //build the project
        child_process.execSync(`npm run build`, { stdio: 'inherit' });
        child_process.execSync(`node dist/index.js`, { stdio: 'inherit' });
    });

    describe('generateBaseRequestOptions', () => {
        it('uses default port', () => {
            expect(rokuDeploy['generateBaseRequestOptions']('a_b_c', { host: '1.2.3.4', password: options.password }).url).to.equal('http://1.2.3.4:80/a_b_c');
        });

        it('uses overridden port', () => {
            expect(rokuDeploy['generateBaseRequestOptions']('a_b_c', { host: '1.2.3.4', packagePort: 999, password: options.password }).url).to.equal('http://1.2.3.4:999/a_b_c');
        });
    });

    describe('pressHomeButton', () => {
        it('rejects promise on error', () => {
            //intercept the post requests
            sinon.stub(request, 'post').callsFake((_, callback) => {
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
            const promise = new Promise<void>((resolve) => {
                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:8060/keypress/Home');
                    resolve();
                });
            });
            await rokuDeploy.pressHomeButton('1.2.3.4');
            await promise;
        });

        it('uses overridden port', async () => {
            const promise = new Promise<void>((resolve) => {
                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:987/keypress/Home');
                    resolve();
                });
            });
            await rokuDeploy.pressHomeButton('1.2.3.4', 987);
            await promise;
        });

        it('uses default timeout', async () => {
            const promise = new Promise<void>((resolve) => {
                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:8060/keypress/Home');
                    expect(opts.timeout).to.equal(150000);
                    resolve();
                });
            });
            await rokuDeploy.pressHomeButton('1.2.3.4');
            await promise;
        });

        it('uses overridden timeout', async () => {
            const promise = new Promise<void>((resolve) => {

                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:987/keypress/Home');
                    expect(opts.timeout).to.equal(1000);
                    resolve();
                });
            });
            await rokuDeploy.pressHomeButton('1.2.3.4', 987, 1000);
            await promise;
        });
    });

    let fileCounter = 1;
    describe('publish', () => {
        beforeEach(() => {
            //make a dummy output file...we don't care what's in it
            options.outFile = `temp${fileCounter++}.zip`;
            try {
                fsExtra.outputFileSync(`${outDir}/${options.outFile}`, 'asdf');
            } catch (e) { }
        });

        it('does not delete the archive by default', async () => {
            let zipPath = `${outDir}/${options.outFile}`;

            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
            await rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                outFile: options.outFile
            });
            //the file should still exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
        });

        it('deletes the archive when configured', async () => {
            let zipPath = `${outDir}/${options.outFile}`;
            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
            await rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                retainDeploymentArchive: false,
                outFile: options.outFile
            });
            //the file should not exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.false;
            //the out folder should also be deleted since it's empty
        });

        it('failure to close read stream does not crash', async () => {
            const orig = rokuDeploy.fsExtra.createReadStream;
            //wrap the stream.close call so we can throw
            sinon.stub(rokuDeploy.fsExtra, 'createReadStream').callsFake((pathLike) => {
                const stream = orig.call(rokuDeploy.fsExtra, pathLike);
                const originalClose = stream.close;
                stream.close = () => {
                    originalClose.call(stream);
                    throw new Error('Crash!');
                };
                return stream;
            });

            let zipPath = `${outDir}/${options.outFile}`;

            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.true;
            await rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                retainDeploymentArchive: false,
                outFile: options.outFile
            });
            //the file should not exist
            expect(fsExtra.pathExistsSync(zipPath)).to.be.false;
            //the out folder should also be deleted since it's empty
        });

        it('fails when the zip file is missing', async () => {
            await expectThrowsAsync(async () => {
                await rokuDeploy.publish({
                    host: '1.2.3.4',
                    password: 'password',
                    outDir: outDir,
                    outFile: 'fileThatDoesNotExist.zip'
                });
            }, `Cannot publish because file does not exist at '${rokuDeploy.getOutputZipFilePath({
                outFile: 'fileThatDoesNotExist.zip',
                outDir: outDir
            })}'`);
        });

        it('fails when no host is provided', () => {
            expectPathNotExists('rokudeploy.json');
            return rokuDeploy.publish({
                host: undefined,
                password: 'password',
                outDir: outDir,
                outFile: options.outFile
            }).then(() => {
                assert.fail('Should not have succeeded');
            }, () => {
                expect(true).to.be.true;
            });
        });

        it('throws when package upload fails', async () => {
            //intercept the post requests
            sinon.stub(request, 'post').callsFake((data: any, callback: any) => {
                if (data.url === `http://1.2.3.4/plugin_install`) {
                    process.nextTick(() => {
                        callback(new Error('Failed to publish to server'));
                    });
                } else {
                    process.nextTick(callback);
                }
                return {} as any;
            });

            try {
                await rokuDeploy.publish({
                    host: '1.2.3.4',
                    password: 'password',
                    outDir: outDir,
                    outFile: options.outFile
                });
            } catch (e) {
                assert.ok('Exception was thrown as expected');
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('rejects as CompileError when initial replace fails', () => {
            mockDoPostRequest(`
                Install Failure: Compilation Failed.
                Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Install Failure: Compilation Failed').trigger('Render', node);
            `);

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                outFile: options.outFile
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err).to.be.instanceOf(errors.CompileError);
            });
        });

        it('rejects as CompileError when initial replace fails', () => {
            mockDoPostRequest(`
                Install Failure: Compilation Failed.
                Shell.create('Roku.Message').trigger('Set message type', 'error').trigger('Set message content', 'Install Failure: Compilation Failed').trigger('Render', node);
            `);

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                outFile: options.outFile
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err).to.be.instanceOf(errors.CompileError);
            });
        });

        it('rejects when response contains compile error wording', () => {
            let body = 'Install Failure: Compilation Failed.';
            mockDoPostRequest(body);

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                outFile: options.outFile
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err.message).to.equal('Compile error');
                expect(true).to.be.true;
            });
        });

        it('rejects when response contains invalid password status code', () => {
            mockDoPostRequest('', 401);

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                outFile: options.outFile
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err.message).to.equal('Unauthorized. Please verify username and password for target Roku.');
                expect(true).to.be.true;
            });
        });

        it('handles successful deploy', () => {
            mockDoPostRequest();

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                outFile: options.outFile
            }).then((result) => {
                expect(result.message).to.equal('Successful deploy');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('handles successful deploy with remoteDebug', () => {
            const stub = mockDoPostRequest();

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                remoteDebug: true,
                outFile: options.outFile
            }).then((result) => {
                expect(result.message).to.equal('Successful deploy');
                expect(stub.getCall(0).args[0].formData.remotedebug).to.eql('1');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('handles successful deploy with remotedebug_connect_early', () => {
            const stub = mockDoPostRequest();

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: true,
                remoteDebug: true,
                remoteDebugConnectEarly: true,
                outFile: options.outFile
            }).then((result) => {
                expect(result.message).to.equal('Successful deploy');
                expect(stub.getCall(0).args[0].formData.remotedebug_connect_early).to.eql('1');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', () => {
            let body = 'Identical to previous version -- not replacing.';
            mockDoPostRequest(body);

            return rokuDeploy.publish({
                host: '1.2.3.4',
                password: 'password',
                outDir: outDir,
                failOnCompileError: false,
                outFile: options.outFile
            }).then((result) => {
                expect(result.results.body).to.equal(body);
            }, () => {
                assert.fail('Should have resolved promise');
            });
        });

        it('rejects when response is unknown status code', async () => {
            let body = 'Identical to previous version -- not replacing.';
            mockDoPostRequest(body, 123);

            try {
                await rokuDeploy.publish({
                    host: '1.2.3.4',
                    password: 'password',
                    outDir: outDir,
                    failOnCompileError: true,
                    outFile: options.outFile
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.InvalidDeviceResponseCodeError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('rejects when user is unauthorized', async () => {
            mockDoPostRequest('', 401);

            try {
                await rokuDeploy.publish({
                    host: '1.2.3.4',
                    password: 'password',
                    outDir: outDir,
                    failOnCompileError: true,
                    outFile: options.outFile
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnauthorizedDeviceResponseError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('rejects when encountering an undefined response', async () => {
            mockDoPostRequest(null);

            try {
                await rokuDeploy.publish({
                    host: '1.2.3.4',
                    password: 'password',
                    outDir: outDir,
                    failOnCompileError: true,
                    outFile: options.outFile
                });
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
            await rokuDeploy.convertToSquashfs({
                host: options.host,
                password: 'password'
            });
        });

        it('should return MissingRequiredOptionError if host was not provided', async () => {
            mockDoPostRequest();
            try {
                options.host = undefined;
                await rokuDeploy.convertToSquashfs({
                    host: options.host,
                    password: 'password'
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.MissingRequiredOptionError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('should return ConvertError if converting failed', async () => {
            mockDoPostRequest();
            try {
                await rokuDeploy.convertToSquashfs({
                    host: options.host,
                    password: 'password'
                });
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
            fsExtra.outputFileSync(path.resolve(rootDir, options.rekeySignedPackage), '');
        });

        it('does not crash when archive is undefined', async () => {
            const expectedError = new Error('Custom error');
            sinon.stub(fsExtra, 'createReadStream').throws(expectedError);
            let actualError: Error;
            try {
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: options.rekeySignedPackage,
                    signingPassword: options.signingPassword,
                    rootDir: options.rootDir,
                    devId: options.devId
                });
            } catch (e) {
                actualError = e as Error;
            }
            expect(actualError).to.equal(expectedError);
        });

        it('should work with relative path', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);
            try {
                fsExtra.writeFileSync(s`${tempDir}/notReal.pkg`, '');
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: s`../notReal.pkg`,
                    signingPassword: options.signingPassword,
                    rootDir: options.rootDir,
                    devId: options.devId
                });
            } finally {
                fsExtra.removeSync(s`${tempDir}/notReal.pkg`);
            }
        });

        it('should work with absolute path', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);
            await rokuDeploy.rekeyDevice({
                host: '1.2.3.4',
                password: 'password',
                rekeySignedPackage: s`${tempDir}/testSignedPackage.pkg`,
                signingPassword: options.signingPassword,
                rootDir: options.rootDir,
                devId: options.devId
            });
        });

        it('should not return an error if dev ID is set and matches output', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);
            await rokuDeploy.rekeyDevice({
                host: '1.2.3.4',
                password: 'password',
                rekeySignedPackage: options.rekeySignedPackage,
                signingPassword: options.signingPassword,
                rootDir: options.rootDir,
                devId: options.devId
            });
        });

        it('should not return an error if dev ID is not set', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);
            await rokuDeploy.rekeyDevice({
                host: '1.2.3.4',
                password: 'password',
                rekeySignedPackage: options.rekeySignedPackage,
                signingPassword: options.signingPassword,
                rootDir: options.rootDir,
                devId: undefined
            });
        });

        it('should throw error if missing rekeySignedPackage option', async () => {
            try {
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: null,
                    signingPassword: options.signingPassword,
                    rootDir: options.rootDir,
                    devId: options.devId
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.MissingRequiredOptionError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw error if missing signingPassword option', async () => {
            try {
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: options.rekeySignedPackage,
                    signingPassword: null,
                    rootDir: options.rootDir,
                    devId: options.devId
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.MissingRequiredOptionError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should throw error if response is not parsable', async () => {
            try {
                mockDoPostRequest();
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: options.rekeySignedPackage,
                    signingPassword: options.signingPassword,
                    rootDir: options.rootDir,
                    devId: options.devId
                });
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
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: options.rekeySignedPackage,
                    signingPassword: options.signingPassword,
                    devId: options.devId
                });
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
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    rekeySignedPackage: options.rekeySignedPackage,
                    signingPassword: options.signingPassword,
                    rootDir: options.rootDir,
                    devId: '45fdc2019903ac333ff624b0b2cddd2c733c3e74'
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnknownDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });
    });

    describe('signExistingPackage', () => {
        beforeEach(() => {
            fsExtra.outputFileSync(`${stagingDir}/manifest`, ``);
        });

        it('should return our error if signingPassword is not supplied', async () => {
            await expectThrowsAsync(async () => {
                await rokuDeploy.signExistingPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: undefined,
                    stagingDir: stagingDir
                });
            }, 'Must supply signingPassword');
        });

        it('should return an error if there is a problem with the network request', async () => {
            let error = new Error('Network Error');
            try {
                //intercept the post requests
                sinon.stub(request, 'post').callsFake((_, callback) => {
                    process.nextTick(callback, error);
                    return {} as any;
                });
                await rokuDeploy.signExistingPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    stagingDir: stagingDir
                });
            } catch (e) {
                expect(e).to.equal(error);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        it('should return our error if it received invalid data', async () => {
            try {
                mockDoPostRequest(null);
                await rokuDeploy.signExistingPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    stagingDir: stagingDir
                });
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

            await expectThrowsAsync(
                rokuDeploy.signExistingPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    stagingDir: stagingDir
                }),
                'Invalid Password.'
            );
        });

        it('should return created pkg on success', async () => {
            let body = `var pkgDiv = document.createElement('div');
                        pkgDiv.innerHTML = '<label>Currently Packaged Application:</label><div><font face="Courier"><a href="pkgs//P6953175d5df120c0069c53de12515b9a.pkg">P6953175d5df120c0069c53de12515b9a.pkg</a> <br> package file (7360 bytes)</font></div>';
                        node.appendChild(pkgDiv);`;
            mockDoPostRequest(body);

            let pkgPath = await rokuDeploy.signExistingPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: options.signingPassword,
                stagingDir: stagingDir
            });
            expect(pkgPath).to.equal('pkgs//P6953175d5df120c0069c53de12515b9a.pkg');
        });

        it('should return our fallback error if neither error or package link was detected', async () => {
            mockDoPostRequest();
            await expectThrowsAsync(
                rokuDeploy.signExistingPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    stagingDir: stagingDir
                }),
                'Unknown error signing package'
            );
        });
    });

    describe('prepublishToStaging', () => {
        it('should use outDir for staging folder', async () => {
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest'
                ],
                rootDir: rootDir
            });
            expectPathExists(`${stagingDir}`);
        });

        it('should support overriding the staging folder', async () => {
            await rokuDeploy.prepublishToStaging({
                files: ['manifest'],
                stagingDir: `${tempDir}/custom-out-dir`,
                rootDir: rootDir
            });
            expectPathExists(`${tempDir}/custom-out-dir`);
        });

        it('handles old glob-style', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest',
                    'source/main.brs'
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/manifest`);
            expectPathExists(`${stagingDir}/source/main.brs`);
        });

        it('handles copying a simple directory by name using src;dest;', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest',
                    {
                        src: 'source/**/*',
                        dest: 'source'
                    }
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/source/main.brs`);
        });

        it('handles new src;dest style', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
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
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/manifest`);
            expectPathExists(`${stagingDir}/source/main.brs`);
        });

        it('handles renaming files', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
                    {
                        src: 'manifest',
                        dest: ''
                    },
                    {
                        src: 'source/main.brs',
                        dest: 'source/renamed.brs'
                    }
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/source/renamed.brs`);
        });

        it('handles absolute src paths', async () => {
            writeFiles(rootDir, [
                'manifest'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
                    {
                        src: sp`${rootDir}/manifest`,
                        dest: ''
                    },
                    {
                        src: 'source/main.brs',
                        dest: 'source/renamed.brs'
                    }
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/manifest`);
        });

        it('handles excluded folders in glob pattern', async () => {
            writeFiles(rootDir, [
                'manifest',
                'components/loader/loader.brs',
                'components/scenes/home/home.brs'
            ]);
            console.log('before');
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest',
                    'components/!(scenes)/**/*'
                ],
                retainStagingDir: true,
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            console.log('after');
            expectPathExists(s`${stagingDir}/components/loader/loader.brs`);
            expectPathNotExists(s`${stagingDir}/components/scenes/home/home.brs`);
        });

        it('handles multi-globs', async () => {
            writeFiles(rootDir, [
                'manifest',
                'components/Loader/Loader.brs',
                'components/scenes/Home/Home.brs'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest',
                    'source',
                    'components/**/*',
                    '!components/scenes/**/*'
                ],
                retainStagingDir: true,
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/components/Loader/Loader.brs`);
            expectPathNotExists(`${stagingDir}/components/scenes/Home/Home.brs`);
        });

        it('throws on invalid entries', async () => {
            try {
                await rokuDeploy.prepublishToStaging({
                    files: [
                        'manifest',
                        <any>{}
                    ],
                    retainStagingDir: true,
                    rootDir: rootDir,
                    stagingDir: stagingDir
                });
                expect(true).to.be.false;
            } catch (e) {
                expect(true).to.be.true;
            }
        });

        it('retains subfolder structure when referencing a folder', async () => {
            fsExtra.outputFileSync(`${rootDir}/flavors/shared/resources/images/fhd/image.jpg`, '');
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest',
                    {
                        src: 'flavors/shared/resources/**/*',
                        dest: 'resources'
                    }
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(`${stagingDir}/resources/images/fhd/image.jpg`);
        });

        it('handles multi-globs subfolder structure', async () => {
            writeFiles(rootDir, [
                'manifest',
                'flavors/shared/resources/images/fhd/image.jpg',
                'resources/image.jpg'
            ]);
            await rokuDeploy.prepublishToStaging({
                files: [
                    'manifest',
                    {
                        //the relative structure after /resources should be retained
                        src: 'flavors/shared/resources/**/*',
                        dest: 'resources'
                    }
                ],
                rootDir: rootDir,
                stagingDir: stagingDir
            });
            expectPathExists(s`${stagingDir}/resources/images/fhd/image.jpg`);
            expectPathNotExists(s`${stagingDir}/resources/image.jpg`);
        });

        describe('symlinks', () => {
            let sourcePath = s`${tempDir}/test.md`;
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
                    fsExtra.ensureDirSync(`${tempDir}/project`);
                    fsExtra.outputFileSync(`${tempDir}/a/alpha.txt`, 'alpha.txt');
                    fsExtra.outputFileSync(`${tempDir}/a/b/c/charlie.txt`, 'charlie.txt');

                    try {
                        //make a file symlink
                        fsExtra.symlinkSync(`${tempDir}/a/alpha.txt`, `${tempDir}/project/alpha.txt`);
                        //create a folder symlink that also includes subfolders
                        fsExtra.symlinkSync(`${tempDir}/a`, `${tempDir}/project/a`);
                        //use glob to scan the directory recursively
                        glob.sync('**/*', {
                            cwd: s`${tempDir}/project`,
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
                //create the actual file
                fsExtra.outputFileSync(sourcePath, 'hello symlink');

                //the source file should exist
                expectPathExists(sourcePath);

                //create the symlink in testProject
                fsExtra.symlinkSync(sourcePath, symlinkPath);

                //the symlink file should exist
                expectPathExists(symlinkPath);
                let opts = {
                    ...options,
                    rootDir: rootDir,
                    files: [
                        'manifest',
                        'renamed_test.md'
                    ]
                };

                let stagingDirValue = rokuDeploy.getOptions(opts).stagingDir;
                //getFilePaths detects the file
                expect(await rokuDeploy.getFilePaths(['renamed_test.md'], opts.rootDir)).to.eql([{
                    src: s`${opts.rootDir}/renamed_test.md`,
                    dest: s`renamed_test.md`
                }]);

                await rokuDeploy.prepublishToStaging({
                    rootDir: rootDir,
                    stagingDir: stagingDir,
                    files: [
                        'manifest',
                        'renamed_test.md'
                    ]
                });
                let stagedFilePath = s`${stagingDirValue}/renamed_test.md`;
                expectPathExists(stagedFilePath);
                let fileContents = await fsExtra.readFile(stagedFilePath);
                expect(fileContents.toString()).to.equal('hello symlink');
            });

            symlinkIt('copies files from subdirs of symlinked folders', async () => {
                fsExtra.ensureDirSync(s`${tempDir}/baseProject/source/lib/promise`);
                fsExtra.writeFileSync(s`${tempDir}/baseProject/source/lib/lib.brs`, `'lib.brs`);
                fsExtra.writeFileSync(s`${tempDir}/baseProject/source/lib/promise/promise.brs`, `'q.brs`);

                fsExtra.ensureDirSync(s`${tempDir}/mainProject/source`);
                fsExtra.writeFileSync(s`${tempDir}/mainProject/source/main.brs`, `'main.brs`);

                //symlink the baseProject lib folder into the mainProject
                fsExtra.symlinkSync(s`${tempDir}/baseProject/source/lib`, s`${tempDir}/mainProject/source/lib`);

                //the symlinked file should exist in the main project
                expect(fsExtra.pathExistsSync(s`${tempDir}/baseProject/source/lib/promise/promise.brs`)).to.be.true;

                let opts = {
                    ...options,
                    rootDir: s`${tempDir}/mainProject`,
                    files: [
                        'manifest',
                        'source/**/*'
                    ]
                };

                let stagingPath = rokuDeploy.getOptions(opts).stagingDir;
                //getFilePaths detects the file
                expect(
                    (await rokuDeploy.getFilePaths(opts.files, opts.rootDir)).sort((a, b) => a.src.localeCompare(b.src))
                ).to.eql([{
                    src: s`${tempDir}/mainProject/source/lib/lib.brs`,
                    dest: s`source/lib/lib.brs`
                }, {
                    src: s`${tempDir}/mainProject/source/lib/promise/promise.brs`,
                    dest: s`source/lib/promise/promise.brs`
                }, {
                    src: s`${tempDir}/mainProject/source/main.brs`,
                    dest: s`source/main.brs`
                }]);

                await rokuDeploy.prepublishToStaging({
                    files: [
                        'manifest',
                        'source/**/*'
                    ],
                    rootDir: s`${tempDir}/mainProject`
                });
                expect(fsExtra.pathExistsSync(`${stagingPath}/source/lib/promise/promise.brs`));
            });
        });
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

            //override the retry milliseconds to make test run faster
            let orig = util.tryRepeatAsync.bind(util);
            sinon.stub(util, 'tryRepeatAsync').callsFake(async (...args) => {
                return orig(args[0], args[1], 0);
            });

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

            await rokuDeploy.prepublishToStaging({
                rootDir: rootDir,
                stagingDir: stagingDir,
                files: [
                    'source/main.brs'
                ]
            });
            expectPathExists(s`${stagingDir}/source/main.brs`);
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

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');
            await expectThrowsAsync(
                rokuDeploy.prepublishToStaging({
                    rootDir: rootDir,
                    stagingDir: stagingDir,
                    files: [
                        'source/main.brs'
                    ]
                }),
                'fake error thrown as part of the unit test'
            );
        });
    });

    describe('normalizeFilesArray', () => {
        it('catches invalid dest entries', () => {
            expect(() => {
                rokuDeploy['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>true
                }]);
            }).to.throw();

            expect(() => {
                rokuDeploy['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>false
                }]);
            }).to.throw();

            expect(() => {
                rokuDeploy['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>/asdf/gi
                }]);
            }).to.throw();

            expect(() => {
                rokuDeploy['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>{}
                }]);
            }).to.throw();

            expect(() => {
                rokuDeploy['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>[]
                }]);
            }).to.throw();
        });

        it('normalizes directory separators paths', () => {
            expect(rokuDeploy['normalizeFilesArray']([{
                src: `long/source/path`,
                dest: `long/dest/path`
            }])).to.eql([{
                src: sp`long/source/path`,
                dest: s`long/dest/path`
            }]);
        });

        it('works for simple strings', () => {
            expect(rokuDeploy['normalizeFilesArray']([
                'manifest',
                'source/main.brs'
            ])).to.eql([
                'manifest',
                'source/main.brs'
            ]);
        });

        it('works for negated strings', () => {
            expect(rokuDeploy['normalizeFilesArray']([
                '!.git'
            ])).to.eql([
                '!.git'
            ]);
        });

        it('skips falsey and bogus entries', () => {
            expect(rokuDeploy['normalizeFilesArray']([
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
            expect(rokuDeploy['normalizeFilesArray']([
                {
                    src: 'manifest'
                }
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }]);
        });

        it('works for {src:string[]} objects', () => {
            expect(rokuDeploy['normalizeFilesArray']([
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
                src: sp`source/main.brs`,
                dest: undefined
            }]);
        });

        it('retains dest option', () => {
            expect(rokuDeploy['normalizeFilesArray']([
                {
                    src: 'source/config.dev.brs',
                    dest: 'source/config.brs'
                }
            ])).to.eql([{
                src: sp`source/config.dev.brs`,
                dest: s`source/config.brs`
            }]);
        });

        it('throws when encountering invalid entries', () => {
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[true])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[/asdf/])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[new Date()])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[1])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[{ src: true }])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[{ src: /asdf/ }])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[{ src: new Date() }])).to.throw();
            expect(() => rokuDeploy['normalizeFilesArray'](<any>[{ src: 1 }])).to.throw();
        });
    });

    describe('deploy', () => {
        it('does the whole migration', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, '');
            mockDoPostRequest();

            writeFiles(rootDir, ['manifest']);

            let result = await rokuDeploy.deploy({
                rootDir: rootDir,
                host: '1.2.3.4',
                password: 'password'
            });
            expect(result).not.to.be.undefined;
        });

        it('continues with deploy if deleteInstalledChannel fails', async () => {
            sinon.stub(rokuDeploy, 'deleteInstalledChannel').returns(
                Promise.reject(
                    new Error('failed')
                )
            );
            mockDoPostRequest();
            let result = await rokuDeploy.deploy({
                host: '1.2.3.4',
                password: 'password',
                ...options,
                //something in the previous test is locking the default output zip file. We should fix that at some point...
                outDir: s`${tempDir}/test1`
            });
            expect(result).not.to.be.undefined;
        });

        it('should delete installed channel if requested', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, '');

            const spy = sinon.spy(rokuDeploy, 'deleteInstalledChannel');
            options.deleteInstalledChannel = true;
            mockDoPostRequest();

            await rokuDeploy.deploy({
                rootDir: rootDir,
                host: '1.2.3.4',
                password: 'password',
                deleteInstalledChannel: true
            });

            expect(spy.called).to.equal(true);
        });

        it('should not delete installed channel if not requested', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, '');

            const spy = sinon.spy(rokuDeploy, 'deleteInstalledChannel');
            mockDoPostRequest();

            await rokuDeploy.deploy({
                rootDir: rootDir,
                host: '1.2.3.4',
                password: 'password',
                deleteInstalledChannel: false
            });

            expect(spy.notCalled).to.equal(true);
        });
    });

    describe('deleteInstalledChannel', () => {
        it('attempts to delete any installed dev channel on the device', async () => {
            mockDoPostRequest();

            let result = await rokuDeploy.deleteInstalledChannel({
                host: '1.2.3.4',
                password: 'password'
            });
            expect(result).not.to.be.undefined;
        });
    });

    describe('takeScreenshot', () => {
        let onHandler: any;
        let screenshotAddress: any;

        beforeEach(() => {

            //intercept the http request
            sinon.stub(request, 'get').callsFake(() => {
                let req: any = {
                    on: (event, callback) => {
                        process.nextTick(() => {
                            onHandler(event, callback);
                        });
                        return req;
                    },
                    pipe: async () => {
                        const writeStream = await writeStreamPromise;
                        writeStream.write(Buffer.from('test-content'));
                        writeStream.close();
                    }
                };
                return req;
            });
        });

        afterEach(() => {
            if (screenshotAddress) {
                fsExtra.removeSync(screenshotAddress);
            }
            onHandler = null;
            screenshotAddress = null;
        });

        it('throws when there is no image returned', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '';
                node.appendChild(screenshoot);
            `);

            mockDoPostRequest(body);
            await expectThrowsAsync(rokuDeploy.takeScreenshot({ host: options.host, password: options.password }));
        });

        it('throws when there is no response body', async () => {
            // missing body
            mockDoPostRequest(null);
            await expectThrowsAsync(rokuDeploy.takeScreenshot({ host: options.host, password: options.password }));
        });

        it('throws when there is an empty response body', async () => {
            // empty body
            mockDoPostRequest();
            await expectThrowsAsync(rokuDeploy.takeScreenshot({ host: options.host, password: options.password }));
        });

        it('throws when there is an error downloading the image from device', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 404
                    });
                }
            };

            mockDoPostRequest(body);
            await expectThrowsAsync(rokuDeploy.takeScreenshot({ host: options.host, password: options.password }));
        });

        it('handles the device returning a png', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password });
            expect(result).not.to.be.undefined;
            expect(path.extname(result)).to.equal('.png');
            expect(fsExtra.existsSync(result));
        });

        it('handles the device returning a jpg', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password });
            expect(result).not.to.be.undefined;
            expect(path.extname(result)).to.equal('.jpg');
            expect(fsExtra.existsSync(result));
        });

        it('take a screenshot from the device and saves to supplied dir', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password, outDir: `${tempDir}/myScreenShots` });
            expect(result).not.to.be.undefined;
            expect(util.standardizePath(`${tempDir}/myScreenShots`)).to.equal(path.dirname(result));
            expect(fsExtra.existsSync(result));
        });

        it('saves to specified file', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password, outDir: tempDir, outFile: 'my' });
            expect(result).not.to.be.undefined;
            expect(util.standardizePath(tempDir)).to.equal(path.dirname(result));
            expect(fsExtra.existsSync(path.join(tempDir, 'my.png')));
        });

        it('saves to specified file ignoring supplied file extension', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password, outDir: tempDir, outFile: 'my.jpg' });
            expect(result).not.to.be.undefined;
            expect(util.standardizePath(tempDir)).to.equal(path.dirname(result));
            expect(fsExtra.existsSync(path.join(tempDir, 'my.jpg.png')));
        });

        it('take a screenshot from the device and saves to temp', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password });
            expect(result).not.to.be.undefined;
            expect(fsExtra.existsSync(result));
        });

        it('take a screenshot from the device and saves to temp but with the supplied file name', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.takeScreenshot({ host: options.host, password: options.password, outFile: 'myFile' });
            expect(result).not.to.be.undefined;
            expect(path.basename(result)).to.equal('myFile.jpg');
            expect(fsExtra.existsSync(result));
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
            writeFiles(rootDir, [
                'components/components/Loader/Loader.brs',
                'images/splash_hd.jpg',
                'source/main.brs',
                'manifest'
            ]);
            const stageFolder = path.join(tempDir, 'testProject');
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

            const outputZipPath = path.join(tempDir, 'output.zip');
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

        it('filters the folders before making the zip', async () => {
            const files = [
                'components/MainScene.brs',
                'components/MainScene.brs.map',
                'images/splash_hd.jpg',
                'source/main.brs',
                'source/main.brs.map',
                'manifest'
            ];
            writeFiles(stagingDir, files);

            const outputZipPath = path.join(tempDir, 'output.zip');
            await rokuDeploy.zipFolder(stagingDir, outputZipPath, null, ['**/*', '!**/*.map']);

            const data = fsExtra.readFileSync(outputZipPath);
            const zip = await JSZip.loadAsync(data);
            //the .map files should be missing
            expect(
                Object.keys(zip.files).sort()
            ).to.eql(
                [
                    'source/',
                    'images/',
                    'components/',
                    ...files
                ].sort().filter(x => !x.endsWith('.map'))
            );
        });
    });

    describe('parseManifest', () => {
        it('correctly parses valid manifest', async () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, `title=AwesomeApp`);
            let parsedManifest = await rokuDeploy.parseManifest(`${rootDir}/manifest`);
            expect(parsedManifest.title).to.equal('AwesomeApp');
        });

        it('Throws our error message for a missing file', async () => {
            await expectThrowsAsync(
                rokuDeploy.parseManifest('invalid-path'),
                `invalid-path does not exist`
            );
        });
    });

    describe('parseManifestFromString', () => {
        it('correctly parses valid manifest', () => {
            let parsedManifest = rokuDeploy.parseManifestFromString(`
                title=RokuDeployTestChannel
                major_version=1
                minor_version=0
                build_version=0
                splash_screen_hd=pkg:/images/splash_hd.jpg
                ui_resolutions=hd
                bs_const=IS_DEV_BUILD=false
                splash_color=#000000
            `);
            expect(parsedManifest.title).to.equal('RokuDeployTestChannel');
            expect(parsedManifest.major_version).to.equal('1');
            expect(parsedManifest.minor_version).to.equal('0');
            expect(parsedManifest.build_version).to.equal('0');
            expect(parsedManifest.splash_screen_hd).to.equal('pkg:/images/splash_hd.jpg');
            expect(parsedManifest.ui_resolutions).to.equal('hd');
            expect(parsedManifest.bs_const).to.equal('IS_DEV_BUILD=false');
            expect(parsedManifest.splash_color).to.equal('#000000');
        });
    });

    describe('stringifyManifest', () => {
        it('correctly converts back to a valid manifest when lineNumber and keyIndexes are provided', () => {
            expect(
                rokuDeploy.stringifyManifest(
                    rokuDeploy.parseManifestFromString('major_version=3\nminor_version=4')
                )
            ).to.equal(
                'major_version=3\nminor_version=4'
            );
        });

        it('correctly converts back to a valid manifest when lineNumber and keyIndexes are not provided', () => {
            const parsed = rokuDeploy.parseManifestFromString('title=App\nmajor_version=3');
            delete parsed.keyIndexes;
            delete parsed.lineCount;
            let outputParsedManifest = rokuDeploy.parseManifestFromString(
                rokuDeploy.stringifyManifest(parsed)
            );
            expect(outputParsedManifest.title).to.equal('App');
            expect(outputParsedManifest.major_version).to.equal('3');
        });
    });

    describe('getFilePaths', () => {
        const otherProjectName = 'otherProject';
        const otherProjectDir = sp`${rootDir}/../${otherProjectName}`;
        //create baseline project structure
        beforeEach(() => {
            fsExtra.ensureDirSync(`${rootDir}/components/emptyFolder`);
            writeFiles(rootDir, [
                `manifest`,
                `source/main.brs`,
                `source/lib.brs`,
                `components/component1.xml`,
                `components/component1.brs`,
                `components/screen1/screen1.xml`,
                `components/screen1/screen1.brs`
            ]);
        });

        async function getFilePaths(files: FileEntry[], rootDirOverride = rootDir) {
            return (await rokuDeploy.getFilePaths(files, rootDirOverride))
                .sort((a, b) => a.src.localeCompare(b.src));
        }

        describe('top-level-patterns', () => {
            it('excludes a file that is negated', async () => {
                expect(await getFilePaths([
                    'source/**/*',
                    '!source/main.brs'
                ])).to.eql([{
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }]);
            });

            it('excludes file from non-rootdir top-level pattern', async () => {
                writeFiles(rootDir, ['../externalDir/source/main.brs']);
                expect(await getFilePaths([
                    '../externalDir/**/*',
                    '!../externalDir/**/*'
                ])).to.eql([]);
            });

            it('throws when using top-level string referencing file outside the root dir', async () => {
                writeFiles(rootDir, [`../source/main.brs`]);
                await expectThrowsAsync(async () => {
                    await getFilePaths([
                        '../source/**/*'
                    ]);
                }, 'Cannot reference a file outside of rootDir when using a top-level string. Please use a src;des; object instead');
            });

            it('works for brighterscript files', async () => {
                writeFiles(rootDir, ['src/source/main.bs']);
                expect(await getFilePaths([
                    'manifest',
                    'source/**/*.bs'
                ], s`${rootDir}/src`)).to.eql([{
                    src: s`${rootDir}/src/source/main.bs`,
                    dest: s`source/main.bs`
                }]);
            });

            it('works for root-level double star in top-level pattern', async () => {
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
                writeFiles(rootDir, [
                    'source/lib.brs',
                    'source/main.brs'
                ]);
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

            it('Finds folder using square brackets glob pattern', async () => {
                fsExtra.outputFileSync(`${rootDir}/e/file.brs`, '');
                expect(await getFilePaths([
                    '[test]/*'
                ],
                rootDir
                )).to.eql([{
                    src: s`${rootDir}/e/file.brs`,
                    dest: s`e/file.brs`
                }]);
            });

            it('Finds folder with escaped square brackets glob pattern as name', async () => {
                fsExtra.outputFileSync(`${rootDir}/[test]/file.brs`, '');
                fsExtra.outputFileSync(`${rootDir}/e/file.brs`, '');
                expect(await getFilePaths([
                    '\\[test\\]/*'
                ],
                rootDir
                )).to.eql([{
                    src: s`${rootDir}/[test]/file.brs`,
                    dest: s`[test]/file.brs`
                }]);
            });

            it('throws exception when top-level strings reference files not under rootDir', async () => {
                writeFiles(otherProjectDir, [
                    'manifest'
                ]);
                await expectThrowsAsync(
                    getFilePaths([
                        `../${otherProjectName}/**/*`
                    ])
                );
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

            it('allows negating paths outside rootDir without requiring src;dest; syntax', async () => {
                fsExtra.outputFileSync(`${rootDir}/../externalLib/source/lib.brs`, '');
                const filePaths = await getFilePaths([
                    'source/**/*',
                    { src: '../externalLib/**/*', dest: 'source' },
                    '!../externalLib/source/**/*'
                ], rootDir);
                expect(
                    filePaths.map(x => s`${x.src}`).sort()
                ).to.eql([
                    s`${rootDir}/source/lib.brs`,
                    s`${rootDir}/source/main.brs`
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
            it('excludes a file that is negated in src;dest;', async () => {
                expect(await getFilePaths([
                    'source/**/*',
                    {
                        src: '!source/main.brs'
                    }
                ])).to.eql([{
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }]);
            });

            it('works for root-level double star in {src;dest} object', async () => {
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
                writeFiles(otherProjectDir, [
                    'components/component1/subComponent/screen.brs',
                    'manifest',
                    'source/thirdPartyLib.brs'
                ]);
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
                writeFiles(otherProjectDir, [
                    'source/thirdPartyLib.brs'
                ]);
                expect(await getFilePaths([{
                    src: `${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: 'lib/thirdPartyLib.brs'
                }])).to.eql([{
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`lib/thirdPartyLib.brs`
                }]);
            });

            it('copies relative path files to specified dest', async () => {
                const rootDirName = path.basename(rootDir);
                writeFiles(rootDir, [
                    'source/main.brs'
                ]);
                expect(await getFilePaths([{
                    src: `../${rootDirName}/source/main.brs`,
                    dest: 'source/main.brs'
                }])).to.eql([{
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('maintains relative path after **', async () => {
                writeFiles(otherProjectDir, [
                    'components/component1/subComponent/screen.brs',
                    'manifest',
                    'source/thirdPartyLib.brs'
                ]);
                expect(await getFilePaths([{
                    src: `../otherProject/**/*`,
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

            it('applies negated patterns', async () => {
                writeFiles(rootDir, [
                    'components/component1.brs',
                    'components/component1.xml',
                    'components/screen1/screen1.brs',
                    'components/screen1/screen1.xml'
                ]);
                expect(await getFilePaths([
                    //include all component brs files
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
            writeFiles(rootDir, [
                'manifest',
                'images/splash_hd.jpg'
            ]);
            //sanity check, make sure it works without fiddling with cwd intact
            let paths = await getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ]);

            expect(paths).to.eql([{
                src: s`${rootDir}/images/splash_hd.jpg`,
                dest: s`images/splash_hd.jpg`
            }, {
                src: s`${rootDir}/manifest`,
                dest: s`manifest`
            }]);

            //change the working directory and verify everything still works

            let wrongCwd = path.dirname(path.resolve(options.rootDir));
            process.chdir(wrongCwd);

            paths = await getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ]);

            expect(paths).to.eql([{
                src: s`${rootDir}/images/splash_hd.jpg`,
                dest: s`images/splash_hd.jpg`
            }, {
                src: s`${rootDir}/manifest`,
                dest: s`manifest`
            }]);
        });

        it('supports absolute paths from outside of the rootDir', async () => {
            options = rokuDeploy.getOptions(options);

            //dest not specified
            expect(await rokuDeploy.getFilePaths([{
                src: sp`${cwd}/README.md`
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`README.md`
            }]);

            //dest specified
            expect(await rokuDeploy.getFilePaths([{
                src: sp`${cwd}/README.md`,
                dest: 'docs/README.md'
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            let paths: any[];

            paths = await rokuDeploy.getFilePaths([{
                src: sp`${cwd}/README.md`,
                dest: s`docs/README.md`
            }], outDir);

            expect(paths).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            //top-level string paths pointing to files outside the root should thrown an exception
            await expectThrowsAsync(async () => {
                paths = await rokuDeploy.getFilePaths([
                    sp`${cwd}/README.md`
                ], outDir);
            });
        });

        it('supports relative paths that grab files from outside of the rootDir', async () => {
            writeFiles(`${rootDir}/../`, [
                'README.md'
            ]);
            expect(
                await rokuDeploy.getFilePaths([{
                    src: sp`../README.md`
                }], rootDir)
            ).to.eql([{
                src: s`${rootDir}/../README.md`,
                dest: s`README.md`
            }]);

            expect(
                await rokuDeploy.getFilePaths([{
                    src: sp`../README.md`,
                    dest: 'docs/README.md'
                }], rootDir)
            ).to.eql([{
                src: s`${rootDir}/../README.md`,
                dest: s`docs/README.md`
            }]);
        });

        it('should throw exception because we cannot have top-level string paths pointed to files outside the root', async () => {
            writeFiles(rootDir, [
                '../README.md'
            ]);
            await expectThrowsAsync(
                rokuDeploy.getFilePaths([
                    path.posix.join('..', 'README.md')
                ], outDir)
            );
        });

        it('supports overriding paths', async () => {
            let paths = await rokuDeploy.getFilePaths([{
                src: sp`${rootDir}/components/component1.brs`,
                dest: 'comp1.brs'
            }, {
                src: sp`${rootDir}/components/screen1/screen1.brs`,
                dest: 'comp1.brs'
            }], rootDir);
            expect(paths).to.be.lengthOf(1);
            expect(s`${paths[0].src}`).to.equal(s`${rootDir}/components/screen1/screen1.brs`);
        });

        it('supports overriding paths from outside the root dir', async () => {
            let thisRootDir = s`${tempDir}/tempTestOverrides/src`;
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

        it('maintains original file path', async () => {
            fsExtra.outputFileSync(`${rootDir}/components/CustomButton.brs`, '');
            expect(
                await rokuDeploy.getFilePaths([
                    'components/CustomButton.brs'
                ], rootDir)
            ).to.eql([{
                src: s`${rootDir}/components/CustomButton.brs`,
                dest: s`components/CustomButton.brs`
            }]);
        });

        it('correctly assumes file path if not given', async () => {
            fsExtra.outputFileSync(`${rootDir}/components/CustomButton.brs`, '');
            expect(
                (await rokuDeploy.getFilePaths([
                    { src: 'components/*' }
                ], rootDir)).sort((a, b) => a.src.localeCompare(b.src))
            ).to.eql([{
                src: s`${rootDir}/components/component1.brs`,
                dest: s`components/component1.brs`
            }, {
                src: s`${rootDir}/components/component1.xml`,
                dest: s`components/component1.xml`
            }, {
                src: s`${rootDir}/components/CustomButton.brs`,
                dest: s`components/CustomButton.brs`
            }]);
        });
    });

    describe('computeFileDestPath', () => {
        it('treats {src;dest} without dest as a top-level string', () => {
            expect(
                rokuDeploy['computeFileDestPath'](s`${rootDir}/source/main.brs`, { src: s`source/main.brs` } as any, rootDir)
            ).to.eql(s`source/main.brs`);
        });
    });

    describe('getDestPath', () => {
        it('handles unrelated exclusions properly', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/components/comp1/comp1.brs`,
                    [
                        '**/*',
                        '!exclude.me'
                    ],
                    rootDir
                )
            ).to.equal(s`components/comp1/comp1.brs`);
        });

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

        it('excludes file from non-rootdir top-level pattern', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/../externalDir/source/main.brs`,
                    [
                        '!../externalDir/**/*'
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

        it('excludes a file found outside the root dir', () => {
            expect(
                rokuDeploy.getDestPath(
                    s`${rootDir}/../source/main.brs`,
                    [
                        '../source/**/*'
                    ],
                    rootDir
                )
            ).to.be.undefined;
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

            //intercept the http request
            sinon.stub(request, 'get').callsFake(() => {
                let req: any = {
                    on: (event, callback) => {
                        process.nextTick(() => {
                            onHandler(event, callback);
                        });
                        return req;
                    },
                    pipe: async () => {
                        //if a write stream gets created, write some stuff and close it
                        const writeStream = await writeStreamPromise;
                        writeStream.write('test');
                        writeStream.close();
                    }
                };
                return req;
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
                host: '1.2.3.4',
                outFile: 'roku-deploy-test',
                password: 'aaaa'
            });
            expect(pkgFilePath).to.equal(path.join(process.cwd(), 'out', 'roku-deploy-test.pkg'));
        });

        it('returns a pkg file path on success', async () => {
            //the write stream should return null, which causes a specific branch to be executed
            createWriteStreamStub.callsFake(() => {
                return null;
            });

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            let error: Error;
            try {
                await rokuDeploy.retrieveSignedPackage('path_to_pkg', {
                    host: '1.2.3.4',
                    password: 'password',
                    outFile: 'roku-deploy-test'
                });
            } catch (e) {
                error = e as any;
            }
            expect(error.message.startsWith('Unable to create write stream for')).to.be.true;
        });

        it('throws when error in request is encountered', async () => {
            onHandler = (event, callback) => {
                if (event === 'error') {
                    callback(new Error('Some error'));
                }
            };
            await expectThrowsAsync(
                rokuDeploy.retrieveSignedPackage('path_to_pkg', {
                    host: '1.2.3.4',
                    outFile: 'roku-deploy-test',
                    password: 'aaaa'
                }),
                'Some error'
            );
        });

        it('throws when status code is non 200', async () => {
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 500
                    });
                }
            };
            await expectThrowsAsync(
                rokuDeploy.retrieveSignedPackage('path_to_pkg', {
                    host: '1.2.3.4',
                    outFile: 'roku-deploy-test',
                    password: 'aaaa'
                }),
                'Invalid response code: 500'
            );
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
        it('supports deprecated stagingFolderPath option', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            expect(
                rokuDeploy.getOptions({ stagingFolderPath: 'staging-folder-path' }).stagingDir
            ).to.eql(s`${cwd}/staging-folder-path`);
            expect(
                rokuDeploy.getOptions({ stagingFolderPath: 'staging-folder-path', stagingDir: 'staging-dir' }).stagingDir
            ).to.eql(s`${cwd}/staging-dir`);
            expect(
                rokuDeploy.getOptions({ stagingFolderPath: 'staging-folder-path' }).stagingFolderPath
            ).to.eql(s`${cwd}/staging-folder-path`);
        });

        it('calling with no parameters works', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            options = rokuDeploy.getOptions(undefined);
            expect(options.stagingDir).to.exist;
        });

        it('calling with empty param object', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            options = rokuDeploy.getOptions({});
            expect(options.stagingDir).to.exist;
        });

        it('works when passing in stagingDir', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return false;
            });
            options = rokuDeploy.getOptions({
                stagingDir: './staging-dir'
            });
            expect(options.stagingDir.endsWith('staging-dir')).to.be.true;
        });

        it('works when loading stagingDir from rokudeploy.json', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return true;
            });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                {
                    "stagingDir": "./staging-dir"
                }
            `);
            options = rokuDeploy.getOptions();
            expect(options.stagingDir.endsWith('staging-dir')).to.be.true;
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
            options = rokuDeploy.getOptions(undefined);
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
            options = rokuDeploy.getOptions(undefined);
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
                rokuDeploy.getOptions(undefined);
            } catch (e) {
                ex = e;
            }
            expect(ex).to.exist;
            expect(ex.message.startsWith('Error parsing')).to.be.true;
        });

        it('does not error when no parameter provided', () => {
            expect(rokuDeploy.getOptions(undefined)).to.exist;
        });

        describe('deleteInstalledChannel', () => {
            it('defaults to true', () => {
                expect(rokuDeploy.getOptions({}).deleteInstalledChannel).to.equal(true);
            });

            it('can be overridden', () => {
                expect(rokuDeploy.getOptions({ deleteInstalledChannel: false }).deleteInstalledChannel).to.equal(false);
            });
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
            beforeEach(() => {
                process.chdir(rootDir);
            });

            it('if no config file is available it should use the default values', () => {
                expect(rokuDeploy.getOptions().outFile).to.equal('roku-deploy');
            });

            it('if rokudeploy.json config file is available it should use those values instead of the default', () => {
                fsExtra.writeJsonSync(s`${rootDir}/rokudeploy.json`, { outFile: 'rokudeploy-outfile' });
                expect(rokuDeploy.getOptions().outFile).to.equal('rokudeploy-outfile');
            });

            it('if bsconfig.json config file is available it should use those values instead of the default', () => {
                fsExtra.writeJsonSync(`${rootDir}/bsconfig.json`, { outFile: 'bsconfig-outfile' });
                expect(rokuDeploy.getOptions().outFile).to.equal('bsconfig-outfile');
            });

            it('if rokudeploy.json config file is available and bsconfig.json is also available it should use rokudeploy.json instead of bsconfig.json', () => {
                fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, { outFile: 'bsconfig-outfile' });
                fsExtra.outputJsonSync(`${rootDir}/rokudeploy.json`, { outFile: 'rokudeploy-outfile' });
                expect(rokuDeploy.getOptions().outFile).to.equal('rokudeploy-outfile');
            });

            it('if runtime options are provided, they should override any existing config file options', () => {
                fsExtra.writeJsonSync(`${rootDir}/bsconfig.json`, { outFile: 'bsconfig-outfile' });
                fsExtra.writeJsonSync(`${rootDir}/rokudeploy.json`, { outFile: 'rokudeploy-outfile' });
                expect(rokuDeploy.getOptions({
                    outFile: 'runtime-outfile'
                }).outFile).to.equal('runtime-outfile');
            });

            it('if runtime config should override any existing config file options', () => {
                fsExtra.writeJsonSync(s`${rootDir}/rokudeploy.json`, { outFile: 'rokudeploy-outfile' });
                fsExtra.writeJsonSync(s`${rootDir}/bsconfig`, { outFile: 'rokudeploy-outfile' });

                fsExtra.writeJsonSync(s`${rootDir}/brsconfig.json`, { outFile: 'project-config-outfile' });
                options = {
                    project: 'brsconfig.json'
                };
                expect(rokuDeploy.getOptions(options).outFile).to.equal('project-config-outfile');
            });
        });
    });

    describe('getToFile', () => {
        it('waits for the write stream to finish writing before resolving', async () => {
            let getToFileIsResolved = false;

            let requestCalled = q.defer();
            let onResponse = q.defer<(res) => any>();

            //intercept the http request
            sinon.stub(request, 'get').callsFake(() => {
                requestCalled.resolve();
                let req: any = {
                    on: (event, callback) => {
                        if (event === 'response') {
                            onResponse.resolve(callback);
                        }
                        return req;
                    },
                    pipe: () => {
                        return req;
                    }
                };
                return req;
            });

            const finalPromise = rokuDeploy['getToFile']({}, s`${tempDir}/out/something.txt`).then(() => {
                getToFileIsResolved = true;
            });

            await requestCalled.promise;
            expect(getToFileIsResolved).to.be.false;

            const callback = await onResponse.promise;
            callback({ statusCode: 200 });
            await util.sleep(10);

            expect(getToFileIsResolved).to.be.false;

            const writeStream = await writeStreamPromise;
            writeStream.write('test');
            writeStream.close();

            await finalPromise;
            expect(getToFileIsResolved).to.be.true;
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
            let stub = sinon.stub(rokuDeploy['fsExtra'], 'remove').returns(Promise.resolve() as any);

            //this should not fail
            let pkgFilePath = await rokuDeploy.deployAndSignPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: 'secret',
                retainStagingDir: false
            });

            //the return value should equal what retrieveSignedPackage returned.
            expect(pkgFilePath).to.equal('some_local_path');

            //fsExtra.remove should have been called
            expect(stub.getCalls()).to.be.lengthOf(1);

            //call it again, but specify true for retainStagingDir
            await rokuDeploy.deployAndSignPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: 'secret',
                retainStagingDir: true
            });
            //call count should NOT increase
            expect(stub.getCalls()).to.be.lengthOf(1);

            //call it again, but don't specify retainStagingDir at all (it should default to FALSE)
            await rokuDeploy.deployAndSignPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: 'secret'
            });
            //call count should NOT increase
            expect(stub.getCalls()).to.be.lengthOf(2);
        });

        it('converts to squashfs if we request it to', async () => {
            // options.convertToSquashfs = true;
            let stub = sinon.stub(rokuDeploy, 'convertToSquashfs').returns(Promise.resolve<any>(null));
            await rokuDeploy.deployAndSignPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: 'secret',
                convertToSquashfs: true
            });
            expect(stub.getCalls()).to.be.lengthOf(1);
        });
    });

    function mockDoGetRequest(body = '', statusCode = 200) {
        return sinon.stub(rokuDeploy as any, 'doGetRequest').callsFake((params) => {
            let results = { response: { statusCode: statusCode }, body: body };
            rokuDeploy['checkRequest'](results);
            return Promise.resolve(results);
        });
    }

    function mockDoPostRequest(body = '', statusCode = 200) {
        return sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params) => {
            let results = { response: { statusCode: statusCode }, body: body };
            rokuDeploy['checkRequest'](results);
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
