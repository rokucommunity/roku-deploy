import * as assert from 'assert';
import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import type { WriteStream, PathLike } from 'fs-extra';
import * as fs from 'fs';
import { defer, type Deferred } from './util';
import * as path from 'path';
import * as JSZip from 'jszip';
import * as child_process from 'child_process';
import * as glob from 'glob';
import * as errors from './Errors';
import { util, standardizePath as s, standardizePathPosix as sp } from './util';
import type { FileEntry, RokuDeployOptions } from './RokuDeployOptions';
import { cwd, expectPathExists, expectPathNotExists, expectThrowsAsync, outDir, rootDir, stagingDir, tempDir, writeFiles } from './testUtils.spec';
import { createSandbox } from 'sinon';
import * as r from 'postman-request';
import { RokuDeploy } from './RokuDeploy';
import type { CaptureScreenshotOptions, ConvertToSquashfsOptions, CreateSignedPackageOptions, DeleteDevChannelOptions, GetDevIdOptions, GetDeviceInfoOptions, RekeyDeviceOptions, SendKeyEventOptions, SideloadOptions } from './RokuDeploy';
const request = r;

const sinon = createSandbox();

describe('RokuDeploy', () => {
    let rokuDeploy: RokuDeploy;
    let options: RokuDeployOptions;

    let writeStreamPromise: Promise<WriteStream>;
    let writeStreamDeferred: Deferred<WriteStream> & { isComplete: true | undefined };
    let createWriteStreamStub: sinon.SinonStub;

    beforeEach(() => {
        rokuDeploy = new RokuDeploy();

        options = {
            rootDir: rootDir,
            stagingDir: stagingDir,
            devId: 'abcde',
            out: `${outDir}/roku-deploy.zip`,
            signingPassword: '12345',
            host: 'localhost',
            pkg: `${tempDir}/testSignedPackage.pkg`
        } as any;
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        fsExtra.ensureDirSync(outDir);
        fsExtra.ensureDirSync(stagingDir);
        //most tests depend on a manifest file existing, so write an empty one
        fsExtra.outputFileSync(`${rootDir}/manifest`, '');

        writeStreamDeferred = defer<WriteStream>() as any;
        writeStreamPromise = writeStreamDeferred.promise as any;

        //fake out the write stream function
        createWriteStreamStub = sinon.stub(fsExtra, 'createWriteStream').callsFake((filePath: PathLike) => {
            const writeStream = fs.createWriteStream(filePath);
            writeStreamDeferred.resolve(writeStream);
            writeStreamDeferred.isComplete = true;
            return writeStream;
        });
    });

    afterEach(() => {
        try {
            if (createWriteStreamStub.called && !writeStreamDeferred.isComplete) {
                writeStreamDeferred.reject('Deferred was never resolved...so rejecting in the afterEach');
            }

            sinon.restore();
            //restore the original working directory
            process.chdir(cwd);
            //delete all temp files
            fsExtra.emptyDirSync(tempDir);
        } catch (e) {
            //not sure why this test fails sometimes in github actions, but hopefully this will mitigate the issue.
            console.error('Error in afterEach:', e);
        }
    });

    after(() => {
        fsExtra.removeSync(tempDir);
    });

    describe('doPostRequest', () => {
        it('should not throw an error for a successful request', async () => {
            let body = 'responseBody';
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, undefined, { statusCode: 200 }, body);
                return {} as any;
            });

            let results = await rokuDeploy['doPostRequest']({} as any, true);
            expect(results.body).to.equal(body);
        });

        it('should throw an error for a network error', async () => {
            let error = new Error('Network Error');
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, error);
                return {} as any;
            });

            try {
                await rokuDeploy['doPostRequest']({} as any, true);
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
                await rokuDeploy['doPostRequest']({} as any, true);
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

            let results = await rokuDeploy['doPostRequest']({} as any, false);
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
            await rokuDeploy.getDeviceInfo({ host: '1.1.1.1', ecpPort: 9999 });
            expect(stub.getCall(0).args[0].url).to.eql('http://1.1.1.1:9999/query/device-info');
        });


        it('does not crash when sanitizing fields that are not defined', async () => {
            mockDoGetRequest(`
                <device-info>
                    <udn>29380007-0800-1025-80a4-d83154332d7e</udn>
                </device-info>
                `);
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10', ecpPort: 8060, enhance: true });
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
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10', ecpPort: 8060, enhance: true });
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
            const result = await rokuDeploy.getDeviceInfo({ host: '192.168.1.10', ecpPort: 8060, enhance: true });
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

        it('handles all error scenarios in catch block', async () => {
            const doGetRequestStub = sinon.stub(rokuDeploy as any, 'doGetRequest');

            // Reject with an error that has details.httpDetails.response.headers.server = 'Roku'
            doGetRequestStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {
                httpDetails: { response: { headers: { server: 'Roku' } } }
            }));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e).to.be.instanceof(errors.EcpNetworkAccessModeDisabledError);
            }

            // Reject with an error that has details.httpDetails.response.headers.server = 'Apache'
            doGetRequestStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {
                httpDetails: { response: { headers: { server: 'Apache' } } }
            }));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect((e as errors.InvalidDeviceResponseCodeError).details.httpDetails?.response?.headers?.server).to.equal('Apache');
            }

            // Reject with an error that has no server header
            doGetRequestStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {
                httpDetails: { response: { headers: {} } }
            }));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect((e as errors.InvalidDeviceResponseCodeError).details.httpDetails?.response?.headers?.server).to.be.undefined;
            }

            // Reject with an error that has server: null
            doGetRequestStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {
                httpDetails: { response: { headers: { server: null as any } } }
            }));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect((e as errors.InvalidDeviceResponseCodeError).details.httpDetails?.response?.headers?.server).to.be.null;
            }

            // Reject with an error that has no headers
            doGetRequestStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {
                httpDetails: { response: {} }
            }));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect((e as errors.InvalidDeviceResponseCodeError).details.httpDetails?.response?.headers).to.be.undefined;
            }

            // Reject with an error that has no httpDetails
            doGetRequestStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {}));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect((e as errors.InvalidDeviceResponseCodeError).details.httpDetails).to.be.undefined;
            }

            // Reject with an empty object (not a proper error)
            doGetRequestStub.rejects({});
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect((e as any).details).to.be.undefined;
            }

            const err = new Error('Network error');
            doGetRequestStub.rejects(err);
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e).to.equal(err);
            }

            // eslint-disable-next-line prefer-promise-reject-errors
            doGetRequestStub.callsFake(() => Promise.reject(null));
            try {
                await rokuDeploy.getDeviceInfo({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e).to.be.null;
            }
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.getDeviceInfo();
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doGetRequest').resolves({ body: '<device-info></device-info>' });
                sinon.stub(util, 'dnsLookup').resolves('constructor-host');
                try {
                    await rd.getDeviceInfo();
                } catch (e) { /* ignore parse errors */ }
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doGetRequest').resolves({ body: '<device-info></device-info>' });
                sinon.stub(util, 'dnsLookup').resolves('call-host');
                try {
                    await rd.getDeviceInfo({ host: 'call-host' });
                } catch (e) { /* ignore parse errors */ }
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });

            it('uses constructor ecpPort when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'localhost', ecpPort: 9000 });
                const stub = sinon.stub(rd as any, 'doGetRequest').resolves({ body: '<device-info></device-info>' });
                sinon.stub(util, 'dnsLookup').resolves('localhost');
                try {
                    await rd.getDeviceInfo();
                } catch (e) { /* ignore parse errors */ }
                expect(stub.getCall(0).args[0].url).to.include(':9000/');
            });

            it('call ecpPort overrides constructor ecpPort', async () => {
                const rd = new RokuDeploy({ host: 'localhost', ecpPort: 9000 });
                const stub = sinon.stub(rd as any, 'doGetRequest').resolves({ body: '<device-info></device-info>' });
                sinon.stub(util, 'dnsLookup').resolves('localhost');
                try {
                    await rd.getDeviceInfo({ ecpPort: 9999 } as any);
                } catch (e) { /* ignore parse errors */ }
                expect(stub.getCall(0).args[0].url).to.include(':9999/');
            });
        });
    });

    describe('getEcpNetworkAccessMode', () => {
        it('returns ecpSettingMode from device info', async () => {
            sinon.stub(rokuDeploy, 'getDeviceInfo').resolves({ 'ecp-setting-mode': 'enabled' } as any);
            const result = await rokuDeploy.getEcpNetworkAccessMode({ host: '1.1.1.1' });
            expect(result).to.equal('enabled');
        });

        it(`returns 'disabled' when response header had Roku in it`, async () => {
            const getDeviceInfoStub = sinon.stub(rokuDeploy, 'getDeviceInfo');
            // Reject with an error that has details.httpDetails.response.headers.server = 'Roku'
            getDeviceInfoStub.rejects(new errors.InvalidDeviceResponseCodeError('test', {
                httpDetails: { response: { headers: { server: 'Roku' } } }
            }));
            expect(await rokuDeploy.getEcpNetworkAccessMode({ host: '1.1.1.1' })).to.equal('disabled');
        });

        it('handles all error scenarios in catch block', async () => {
            const getDeviceInfoStub = sinon.stub(rokuDeploy, 'getDeviceInfo');
            async function doTest(rejectionValue: any) {
                getDeviceInfoStub.rejects(rejectionValue);
                try {
                    await rokuDeploy.getEcpNetworkAccessMode({ host: '1.1.1.1' });
                    assert.fail('Exception should have been thrown');
                } catch (e) {
                    expect(e).to.be.instanceof(errors.UnknownDeviceResponseError);
                }
            }

            // Test with various errors that don't have Roku in the server header - should throw UnknownDeviceResponseError
            await doTest(new errors.InvalidDeviceResponseCodeError('test', { httpDetails: { response: { headers: { server: 'Apache' } } } }));
            await doTest(new errors.InvalidDeviceResponseCodeError('test', { httpDetails: { response: { headers: {} } } }));
            await doTest(new errors.InvalidDeviceResponseCodeError('test', { httpDetails: { response: { headers: { server: null as any } } } }));
            await doTest(new errors.InvalidDeviceResponseCodeError('test', { httpDetails: { response: {} } }));
            await doTest(new errors.InvalidDeviceResponseCodeError('test', {}));
            await doTest({});
            await doTest(new Error('Network error'));
        });

        it('handles null error from rejected promise', async () => {
            const getDeviceInfoStub = sinon.stub(rokuDeploy, 'getDeviceInfo');
            getDeviceInfoStub.callsFake(() => Promise.reject(null));
            try {
                await rokuDeploy.getEcpNetworkAccessMode({ host: '1.1.1.1' });
                assert.fail('Exception should have been thrown');
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnknownDeviceResponseError);
            }
        });
    });

    describe('normalizeDeviceInfoFieldValue', () => {
        it('converts normal values', () => {
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('true')).to.eql(true);
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('false')).to.eql(false);
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('1')).to.eql(1);
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('1.2')).to.eql(1.2);
            //it'll trim whitespace too
            expect(rokuDeploy['normalizeDeviceInfoFieldValue'](' 1.2')).to.eql(1.2);
            expect(rokuDeploy['normalizeDeviceInfoFieldValue'](' 1.2 ')).to.eql(1.2);
        });

        it('leaves invalid numbers as strings', () => {
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('v1.2.3')).to.eql('v1.2.3');
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('1.2.3-alpha.1')).to.eql('1.2.3-alpha.1');
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('123Four')).to.eql('123Four');
        });

        it('decodes HTML entities', () => {
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('3&4')).to.eql('3&4');
            expect(rokuDeploy['normalizeDeviceInfoFieldValue']('3&amp;4')).to.eql('3&4');
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

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.getDevId();
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                sinon.stub(rd, 'getDeviceInfo').resolves({ 'keyed-developer-id': 'abc123' } as any);
                const result = await rd.getDevId();
                expect(result).to.equal('abc123');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd, 'getDeviceInfo').resolves({ 'keyed-developer-id': 'abc123' } as any);
                await rd.getDevId({ host: 'call-host' });
                expect(stub.getCall(0).args[0].host).to.equal('call-host');
            });
        });
    });

    describe('zip', () => {
        it('should throw error when manifest is missing', async () => {
            let err;
            try {
                fsExtra.ensureDirSync(options.stagingDir);
                await rokuDeploy.zip({
                    dir: s`${tempDir}/path/to/nowhere`,
                    out: `${outDir}/roku-deploy.zip`
                });
            } catch (e) {
                err = (e as Error);
            }
            expect(err?.message.startsWith('Cannot zip'), `Unexpected error message: "${err.message}"`).to.be.true;
        });

        it('should throw error when manifest is missing and stagingDir does not exist', async () => {
            let err;
            try {
                await rokuDeploy.zip({
                    dir: s`${tempDir}/path/to/nowhere`,
                    out: `${outDir}/roku-deploy.zip`
                });
            } catch (e) {
                err = (e as Error);
            }
            expect(err).to.exist;
            expect(err.message.startsWith('Cannot zip'), `Unexpected error message: "${err.message}"`).to.be.true;
        });

        it('should zip only files matching the files array filter', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, 'title=Test');
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, 'sub main()\nend sub');
            fsExtra.outputFileSync(s`${rootDir}/components/comp.xml`, '<component />');
            fsExtra.outputFileSync(s`${rootDir}/extra/stuff.txt`, 'should not be included');

            await rokuDeploy.zip({
                dir: rootDir,
                files: ['manifest', 'source/**/*'],
                out: `${outDir}/roku-deploy.zip`
            });

            const zip = new JSZip();
            const zipContents = await zip.loadAsync(fsExtra.readFileSync(`${outDir}/roku-deploy.zip`));
            expect(zipContents.files['manifest']).to.exist;
            expect(zipContents.files['source/main.brs']).to.exist;
            expect(zipContents.files['components/comp.xml']).to.not.exist;
            expect(zipContents.files['extra/stuff.txt']).to.not.exist;
        });

        it('should throw error when files filter excludes manifest', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, 'title=Test');
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, 'sub main()\nend sub');

            let err: Error | undefined;
            try {
                await rokuDeploy.zip({
                    dir: rootDir,
                    files: ['source/**/*'],
                    out: `${outDir}/roku-deploy.zip`
                });
            } catch (e) {
                err = e as Error;
            }
            expect(err?.message).to.include('missing manifest');
        });

        it('should zip all files when files array is not provided', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, 'title=Test');
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, 'sub main()\nend sub');
            fsExtra.outputFileSync(s`${rootDir}/components/comp.xml`, '<component />');

            await rokuDeploy.zip({
                dir: rootDir,
                out: `${outDir}/roku-deploy.zip`
            });

            const zip = new JSZip();
            const zipContents = await zip.loadAsync(fsExtra.readFileSync(`${outDir}/roku-deploy.zip`));
            expect(zipContents.files['manifest']).to.exist;
            expect(zipContents.files['source/main.brs']).to.exist;
            expect(zipContents.files['components/comp.xml']).to.exist;
        });

        it('should return the provided out path', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, 'title=Test');
            const expectedPath = s`${outDir}/my-custom.zip`;

            const result = await rokuDeploy.zip({
                dir: rootDir,
                out: expectedPath
            });

            expect(result).to.equal(expectedPath);
        });

        it('should return the default path when out is not specified', async () => {
            fsExtra.outputFileSync(s`${rootDir}/manifest`, 'title=Test');

            const result = await rokuDeploy.zip({
                dir: rootDir
            });

            const expectedPath = path.resolve(process.cwd(), RokuDeploy['defaults'].outDir, RokuDeploy['defaults'].outFile);
            expect(result).to.equal(expectedPath);
        });

    });

    it('runs via the command line using the rokudeploy.json file', function test() {
        this.timeout(60_000);
        //build the project
        child_process.execSync(`npm run build`, { stdio: 'inherit' });
        child_process.execSync(`node dist/index.js`, { stdio: 'inherit' });
    });

    describe('generateBaseRequestOptions', () => {
        it('uses default port', () => {
            expect(rokuDeploy['generateBaseRequestOptions']('a_b_c', { host: '1.2.3.4', password: 'password' }).url).to.equal('http://1.2.3.4:80/a_b_c');
        });

        it('uses overridden port', () => {
            expect(rokuDeploy['generateBaseRequestOptions']('a_b_c', { host: '1.2.3.4', packagePort: 999, password: 'password' }).url).to.equal('http://1.2.3.4:999/a_b_c');
        });
    });

    describe('pressHomeButton', () => {
        it('rejects promise on error', () => {
            //intercept the post requests
            sinon.stub(request, 'post').callsFake((_, callback) => {
                process.nextTick(callback, new Error());
                return {} as any;
            });
            return rokuDeploy.keyPress({ ...options, host: '1.2.3.4', key: 'home' }).then(() => {
                assert.fail('Should have rejected the promise');
            }, () => {
                expect(true).to.be.true;
            });
        });

        it('uses default port', async () => {
            const promise = new Promise<void>((resolve) => {
                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:8060/keypress/home');
                    resolve();
                });
            });
            await rokuDeploy.keyPress({ ...options, host: '1.2.3.4', key: 'home' });
            await promise;
        });

        it('uses overridden port', async () => {
            const promise = new Promise<void>((resolve) => {
                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:987/keypress/home');
                    resolve();
                });
            });
            await rokuDeploy.keyPress({ ...options, host: '1.2.3.4', ecpPort: 987, key: 'home' });
            await promise;
        });

        it('uses default timeout', async () => {
            const promise = new Promise<void>((resolve) => {
                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:8060/keypress/home');
                    expect(opts.timeout).to.equal(150000);
                    resolve();
                });
            });
            await rokuDeploy.keyPress({ ...options, host: '1.2.3.4', key: 'home' });
            await promise;
        });

        it('uses overridden timeout', async () => {
            const promise = new Promise<void>((resolve) => {

                sinon.stub(<any>rokuDeploy, 'doPostRequest').callsFake((opts: any) => {
                    expect(opts.url).to.equal('http://1.2.3.4:987/keypress/home');
                    expect(opts.timeout).to.equal(1000);
                    resolve();
                });
            });
            await rokuDeploy.keyPress({ ...options, host: '1.2.3.4', ecpPort: 987, key: 'home', timeout: 1000 });
            await promise;
        });
    });

    describe('keyPress', () => {
        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.keyPress({ key: 'home' } as any);
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.keyPress({ key: 'home' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.keyPress({ host: 'call-host', key: 'home' });
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('keyUp', () => {
        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.keyUp({ key: 'home' } as any);
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.keyUp({ key: 'home' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.keyUp({ host: 'call-host', key: 'home' });
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('keyDown', () => {
        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.keyDown({ key: 'home' } as any);
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.keyDown({ key: 'home' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.keyDown({ host: 'call-host', key: 'home' });
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('sendText', () => {
        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.sendText({ text: 'a' } as any);
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.sendText({ text: 'a' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.sendText({ host: 'call-host', text: 'a' });
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('closeChannel', () => {
        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy();
                await expectThrowsAsync(async () => {
                    await rd.closeChannel({} as any);
                }, 'Missing required option: host');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.closeChannel({} as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                await rd.closeChannel({ host: 'call-host' });
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    let fileCounter = 1;
    let zipFile: string;
    describe('sideload', () => {
        beforeEach(() => {
            //make a dummy output file...we don't care what's in it
            zipFile = `${outDir}/temp${fileCounter++}.zip`;
            try {
                fsExtra.outputFileSync(zipFile, 'asdf');
            } catch (e) { }
        });

        it('uses overridden route', async () => {
            const stub = mockDoPostRequest();
            await rokuDeploy.sideload({
                host: '0.0.0.0',
                password: 'password',
                zip: zipFile,
                close: false,
                packageUploadOverrides: {
                    route: 'alt_path'
                }
            });
            expect(stub.getCall(1).args[0].url).to.eql('http://0.0.0.0:80/alt_path');
        });

        it('overrides formData', async () => {
            const stub = mockDoPostRequest();
            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                remoteDebug: true,
                close: false,
                packageUploadOverrides: {
                    formData: {
                        remotedebug: null,
                        newfield: 'here'
                    }
                }
            });
            expect(stub.getCall(1).args[0].formData).to.include({
                newfield: 'here'
            }).and.to.not.haveOwnProperty('remotedebug');
        });

        it('does not delete the generated archive by default', async () => {
            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipFile)).to.be.true;
            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                close: false
            });
            //the file should still exist (pre-built zips are retained by default)
            expect(fsExtra.pathExistsSync(zipFile)).to.be.true;
        });

        it('deletes the generated archive by default when using dir', async () => {
            mockDoPostRequest();

            //the file should exist (created in beforeEach)
            expect(fsExtra.pathExistsSync(zipFile)).to.be.true;
            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                dir: rootDir,
                close: false
            });
            //the generated archive should be deleted by default
            expect(fsExtra.pathExistsSync(s`${outDir}/roku-deploy.zip`)).to.be.false;
        });

        it('failure to close read stream does not crash', async () => {
            const orig = fsExtra.createReadStream;
            //wrap the stream.close call so we can throw
            sinon.stub(fsExtra, 'createReadStream').callsFake((pathLike) => {
                const stream = orig.call(fsExtra, pathLike);
                const originalClose = stream.close;
                stream.close = () => {
                    originalClose.call(stream);
                    throw new Error('Crash!');
                };
                return stream;
            });

            mockDoPostRequest();

            //the file should exist
            expect(fsExtra.pathExistsSync(zipFile)).to.be.true;
            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                dir: rootDir,
                close: false
            });
            //the file should not exist (dir generates a temp zip that gets deleted)
            expect(fsExtra.pathExistsSync(s`${outDir}/roku-deploy.zip`)).to.be.false;
        });

        it('fails when the zip file is missing', async () => {
            const missingZip = s`${outDir}/fileThatDoesNotExist.zip`;
            await expectThrowsAsync(async () => {
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    zip: missingZip,
                    deleteDevChannel: false,
                    close: false
                });
            }, `Cannot sideload because file does not exist at '${missingZip}'`);
        });

        it('fails when no host is provided', () => {
            expectPathNotExists('rokudeploy.json');
            return rokuDeploy.sideload({
                host: undefined,
                password: 'password',
                zip: zipFile
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
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    zip: zipFile,
                    close: false
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

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                close: false
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

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                close: false
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err).to.be.instanceOf(errors.CompileError);
            });
        });

        it('rejects when response contains compile error wording', () => {
            let body = 'Install Failure: Compilation Failed.';
            mockDoPostRequest(body);

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                close: false
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err.message).to.equal('Compile error');
                expect(true).to.be.true;
            });
        });

        it('checkRequest handles edge case', () => {
            function doTest(results, hostValue = undefined) {
                let error: Error;
                try {
                    rokuDeploy['checkRequest'](results);
                } catch (e) {
                    error = e as any;
                }
                expect(error.message).to.eql(`Unauthorized. Please verify credentials for host '${hostValue}'`);
            }
            doTest({ body: 'something', response: { statusCode: 401, request: { host: '1.1.1.1' } } }, '1.1.1.1');
            doTest({ body: 'something', response: { statusCode: 401, request: { host: undefined } } });
            doTest({ body: 'something', response: { statusCode: 401, request: undefined } });
        });

        it('rejects when response contains invalid password status code', () => {
            mockDoPostRequest('', 401);

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                close: false
            }).then(() => {
                assert.fail('Should not have succeeded due to roku server compilation failure');
            }, (err) => {
                expect(err.message).to.be.a('string').and.satisfy(msg => msg.startsWith('Unauthorized. Please verify credentials for host'));
                expect(true).to.be.true;
            });
        });

        it('rejects when response contains update device messaging', async () => {
            options.failOnCompileError = true;
            mockDoPostRequest(`'Failed to check for software update'`, 200);

            try {
                await rokuDeploy.sideload(
                    {
                        host: '1.2.3.4',
                        password: 'password',
                        zip: zipFile,
                        close: false
                    }
                );
                assert.fail('Should not have succeeded due to roku server compilation failure');
            } catch (err) {
                expect((err as any).message).to.eql(
                    errors.UpdateCheckRequiredError.MESSAGE
                );
            }
        });

        it('rejects when response contains update device messaging and bad status code on first call', async () => {
            options.failOnCompileError = true;
            let spy = sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params: any) => {
                let results: any;
                if (params?.formData['mysubmit'] === 'Replace') {
                    results = { response: { statusCode: 500 }, body: `'Failed to check for software update'` };
                } else {
                    results = { response: { statusCode: 200 }, body: `` };
                }
                rokuDeploy['checkRequest'](results);
                return Promise.resolve(results);
            });

            try {
                await rokuDeploy.sideload(
                    {
                        host: '1.2.3.4',
                        password: 'password',
                        zip: zipFile,
                        deleteDevChannel: false,
                        close: false
                    }
                );
                assert.fail('Should not have succeeded due to roku server compilation failure');
            } catch (err) {
                expect(spy.callCount).to.eql(1);
                expect((err as any).message).to.eql(
                    errors.UpdateCheckRequiredError.MESSAGE
                );
            }
        });

        it('rejects when response contains update device messaging and bad status code on second call', async () => {
            options.failOnCompileError = true;
            let spy = sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params: any) => {
                let results: any;
                if (params?.formData['mysubmit'] === 'Replace') {
                    results = { response: { statusCode: 500 }, body: `` };
                } else {
                    results = { response: { statusCode: 200 }, body: `'Failed to check for software update'` };
                }
                rokuDeploy['checkRequest'](results);
                return Promise.resolve(results);
            });

            try {
                await rokuDeploy.sideload(
                    {
                        host: '1.2.3.4',
                        password: 'password',
                        zip: zipFile,
                        deleteDevChannel: false,
                        close: false
                    }
                );
                assert.fail('Should not have succeeded due to roku server compilation failure');
            } catch (err) {
                expect(spy.callCount).to.eql(2);
                expect((err as any).message).to.eql(
                    errors.UpdateCheckRequiredError.MESSAGE
                );
            }
        });

        it('handles successful deploy', () => {
            mockDoPostRequest();

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                close: false
            }).then((result) => {
                expect(result.message).to.equal('Successful sideload');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('handles successful deploy with remoteDebug', () => {
            const stub = mockDoPostRequest();

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                remoteDebug: true,
                deleteDevChannel: false,
                close: false
            }).then((result) => {
                expect(result.message).to.equal('Successful sideload');
                expect(stub.getCall(0).args[0].formData.remotedebug).to.eql('1');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('handles successful deploy with remotedebug_connect_early', () => {
            const stub = mockDoPostRequest();

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                remoteDebug: true,
                remoteDebugConnectEarly: true,
                deleteDevChannel: false,
                close: false
            }).then((result) => {
                expect(result.message).to.equal('Successful sideload');
                expect(stub.getCall(0).args[0].formData.remotedebug_connect_early).to.eql('1');
            }, () => {
                assert.fail('Should not have rejected the promise');
            });
        });

        it('does not set appType if not explicitly defined', async () => {
            delete options.appType;
            const stub = mockDoPostRequest();

            fsExtra.outputFileSync(zipFile, 'asdf');

            const result = await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                deleteDevChannel: false,
                close: false
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.be.undefined;
        });

        it('does not set appType if not appType is set to null or undefined', async () => {
            const stub = mockDoPostRequest();
            fsExtra.outputFileSync(zipFile, 'asdf');

            const result = await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                deleteDevChannel: false,
                close: false,
                appType: null
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.be.undefined;
        });

        it('sets appType="channel" when defined', async () => {
            const stub = mockDoPostRequest();
            fsExtra.outputFileSync(zipFile, 'asdf');

            const result = await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                deleteDevChannel: false,
                close: false,
                appType: 'channel'
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.eql('channel');
        });

        it('sets appType="dcl" when defined', async () => {
            const stub = mockDoPostRequest();
            fsExtra.outputFileSync(zipFile, 'asdf');

            const result = await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                deleteDevChannel: false,
                close: false,
                appType: 'dcl'
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.eql('dcl');
        });

        it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', async () => {
            const stub = mockDoPostRequest();
            options.failOnCompileError = false;

            const result = await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                remoteDebug: true,
                remoteDebugConnectEarly: true,
                deleteDevChannel: false,
                close: false
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.be.undefined;
        });

        it('does not set appType if not appType is set to null or undefined', async () => {
            const stub = mockDoPostRequest();

            const result = await rokuDeploy.sideload({
                appType: null,
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                remoteDebug: true,
                remoteDebugConnectEarly: true,
                deleteDevChannel: false,
                close: false
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.be.undefined;
        });

        it('sets appType="channel" when defined', async () => {
            const stub = mockDoPostRequest();

            const result = await rokuDeploy.sideload({
                appType: 'channel',
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                remoteDebug: true,
                remoteDebugConnectEarly: true,
                deleteDevChannel: false,
                close: false
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.eql('channel');
        });

        it('sets appType="dcl" when defined', async () => {
            const stub = mockDoPostRequest();

            const result = await rokuDeploy.sideload({
                appType: 'dcl',
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: true,
                remoteDebug: true,
                remoteDebugConnectEarly: true,
                deleteDevChannel: false,
                close: false
            });
            expect(result.message).to.equal('Successful sideload');
            expect(stub.getCall(0).args[0].formData.app_type).to.eql('dcl');
        });

        it('Does not reject when response contains compile error wording but config is set to ignore compile warnings', () => {
            let body = 'Identical to previous version -- not replacing.';
            mockDoPostRequest(body);

            return rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipFile,
                failOnCompileError: false,
                close: false
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
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    failOnCompileError: true,
                    zip: zipFile,
                    close: false
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
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    failOnCompileError: true,
                    zip: zipFile,
                    close: false
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
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    failOnCompileError: true,
                    zip: zipFile,
                    close: false
                });
            } catch (e) {
                assert.ok('Exception was thrown as expected');
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('Should throw an exception and call doPost once', async () => {
            options.failOnCompileError = true;
            let spy = mockDoPostRequest('', 577);

            try {
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    zip: zipFile,
                    deleteDevChannel: false,
                    close: false
                });
            } catch (e) {
                expect(spy.callCount).to.eql(1);
                assert.ok('Exception was thrown as expected');
                expect(e).to.be.instanceof(errors.UpdateCheckRequiredError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('Should throw an exception and should call doPost twice', async () => {
            options.failOnCompileError = true;
            let spy = sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params: any) => {
                let results: any;
                if (params?.formData['mysubmit'] === 'Replace') {
                    results = { response: { statusCode: 500 }, body: `'not an update error'` };
                } else {
                    results = { response: { statusCode: 577 }, body: `` };
                }
                rokuDeploy['checkRequest'](results);
                return Promise.resolve(results);
            });

            try {
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    zip: zipFile,
                    deleteDevChannel: false,
                    close: false
                });
            } catch (e) {
                expect(spy.callCount).to.eql(2);
                assert.ok('Exception was thrown as expected');
                expect(e).to.be.instanceof(errors.UpdateCheckRequiredError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        class ErrorWithConnectionResetCode extends Error {
            code;

            constructor(code = 'ECONNRESET') {
                super();
                this.code = code;
            }
        }

        it('Should throw an exception', async () => {
            options.failOnCompileError = true;
            sinon.stub(rokuDeploy as any, 'doPostRequest').callsFake((params) => {
                throw new ErrorWithConnectionResetCode();
            });

            try {
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: 'password',
                    zip: zipFile,
                    close: false
                });
            } catch (e) {
                assert.ok('Exception was thrown as expected');
                expect(e).to.be.instanceof(errors.ConnectionResetError);
                return;
            }
            assert.fail('Should not have succeeded');
        });

        it('succeeds when using a pre-built zip', async () => {
            mockDoPostRequest();
            const zipPath = `${outDir}/myapp.zip`;
            fsExtra.outputFileSync(zipPath, 'zip contents');

            const result = await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipPath,
                close: false
            });
            expect(result.message).to.equal('Successful sideload');
        });

        it('calls closeChannel before sideloading by default', async () => {
            mockDoPostRequest();
            const closeChannelStub = sinon.stub(rokuDeploy, 'closeChannel').resolves();
            const zipPath = `${outDir}/myapp.zip`;
            fsExtra.outputFileSync(zipPath, 'zip contents');

            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipPath
            });
            expect(closeChannelStub.callCount).to.eql(1);
        });

        it('skips closeChannel when close is false', async () => {
            mockDoPostRequest();
            const closeChannelStub = sinon.stub(rokuDeploy, 'closeChannel').resolves();
            const zipPath = `${outDir}/myapp.zip`;
            fsExtra.outputFileSync(zipPath, 'zip contents');

            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                zip: zipPath,
                close: false
            });
            expect(closeChannelStub.callCount).to.eql(0);
        });

        it('triggers zip when dir is provided', async () => {
            mockDoPostRequest();
            // Stub zip to create the file at the path sideload expects
            const zipStub = sinon.stub(rokuDeploy, 'zip').callsFake((zipOptions) => {
                fsExtra.outputFileSync(zipOptions.out, 'dummy');
                return Promise.resolve(zipOptions.out);
            });
            sinon.stub(rokuDeploy, 'closeChannel').resolves();

            await rokuDeploy.sideload({
                host: '1.2.3.4',
                password: 'password',
                dir: rootDir
            });
            expect(zipStub.callCount).to.eql(1);
        });

        it('fails when no password is provided', async () => {
            await expectThrowsAsync(async () => {
                await rokuDeploy.sideload({
                    host: '1.2.3.4',
                    password: undefined,
                    zip: zipFile
                });
            }, 'Missing required option: password');
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.sideload({ zip: 'test.zip' } as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.sideload({ zip: 'test.zip' } as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                sinon.stub(rd, 'deleteDevChannel').resolves();
                sinon.stub(rd, 'closeChannel').resolves();
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({ close: () => { }, on: (event, cb) => cb() } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: 'success', response: { statusCode: 200 } });
                await rd.sideload({ zip: 'test.zip' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                sinon.stub(rd, 'deleteDevChannel').resolves();
                sinon.stub(rd, 'closeChannel').resolves();
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({ close: () => { }, on: (event, cb) => cb() } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: 'success', response: { statusCode: 200 } });
                await rd.sideload({ host: 'call-host', zip: 'test.zip' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });

            it('uses constructor password when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'localhost', password: 'constructor-pass' });
                sinon.stub(rd, 'deleteDevChannel').resolves();
                sinon.stub(rd, 'closeChannel').resolves();
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({ close: () => { }, on: (event, cb) => cb() } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: 'success', response: { statusCode: 200 } });
                await rd.sideload({ zip: 'test.zip' } as any);
                expect(stub.getCall(0).args[0].auth.pass).to.equal('constructor-pass');
            });

            it('call password overrides constructor password', async () => {
                const rd = new RokuDeploy({ host: 'localhost', password: 'constructor-pass' });
                sinon.stub(rd, 'deleteDevChannel').resolves();
                sinon.stub(rd, 'closeChannel').resolves();
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({ close: () => { }, on: (event, cb) => cb() } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: 'success', response: { statusCode: 200 } });
                await rd.sideload({ password: 'call-pass', zip: 'test.zip' } as any);
                expect(stub.getCall(0).args[0].auth.pass).to.equal('call-pass');
            });
        });
    });

    describe('squash', () => {
        it('should not return an error if successful', async () => {
            mockDoPostRequest('<font color="red">Conversion succeeded<p></p><code><br>Parallel mksquashfs: Using 1 processor');
            await rokuDeploy.convertToSquashfs({
                host: options.host,
                password: 'password'
            });
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

        it('should throw with HPE_INVALID_CONSTANT and then succeed on retry', async () => {
            let doPostStub = sinon.stub(rokuDeploy as any, 'doPostRequest');
            doPostStub.onFirstCall().throws((params) => {
                throw new ErrorWithCode();
            });
            doPostStub.onSecondCall().returns({ body: '..."fileType":"squashfs"...' });
            try {
                await rokuDeploy.convertToSquashfs({
                    ...options,
                    host: options.host,
                    password: 'password'
                });
            } catch (e) {
                assert.fail('Should not have throw');
            }
        });

        it('should throw and not retry', async () => {
            let doPostStub = sinon.stub(rokuDeploy as any, 'doPostRequest');
            doPostStub.onFirstCall().throws((params) => {
                throw new ErrorWithCode('Something else');
            });
            try {
                await rokuDeploy.convertToSquashfs({
                    ...options,
                    host: options.host,
                    password: 'password'
                });
            } catch (e) {
                expect(e).to.be.instanceof(ErrorWithCode);
                expect(e['code']).to.be.eql('Something else');
                return;
            }
            assert.fail('Should not have throw');
        });

        it('should throw with HPE_INVALID_CONSTANT and then fail on retry', async () => {
            let doPostStub = sinon.stub(rokuDeploy as any, 'doPostRequest');
            doPostStub.onFirstCall().throws((params) => {
                throw new ErrorWithCode();
            });
            doPostStub.onSecondCall().returns({ body: '..."fileType":"zip"...' });
            try {
                await rokuDeploy.convertToSquashfs({
                    ...options,
                    host: options.host,
                    password: 'password'
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.ConvertError);
                return;
            }
            assert.fail('Should not have throw');
        });

        it('should fail with HPE_INVALID_CONSTANT and then throw on retry', async () => {
            let doPostStub = sinon.stub(rokuDeploy as any, 'doPostRequest');
            doPostStub.onFirstCall().throws((params) => {
                throw new ErrorWithCode();
            });
            doPostStub.onSecondCall().throws((params) => {
                throw new Error('Never seen');
            });
            try {
                await rokuDeploy.convertToSquashfs({
                    ...options,
                    host: options.host,
                    password: 'password'
                });
            } catch (e) {
                expect(e).to.be.instanceof(ErrorWithCode);
                return;
            }
            assert.fail('Should not have throw');
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.convertToSquashfs({} as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.convertToSquashfs({} as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: 'Conversion succeeded' });
                await rd.convertToSquashfs({} as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: 'Conversion succeeded' });
                await rd.convertToSquashfs({ host: 'call-host' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    class ErrorWithCode extends Error {
        code;

        constructor(code = 'HPE_INVALID_CONSTANT') {
            super();
            this.code = code;
        }
    }

    describe('rekey', () => {
        beforeEach(() => {
            const body = `<device-info>
                <keyed-developer-id>${options.devId}</keyed-developer-id>
            </device-info>`;
            mockDoGetRequest(body);
            fsExtra.outputFileSync(path.resolve(rootDir, options.pkg), '');
        });

        it('does not crash when archive is undefined', async () => {
            const expectedError = new Error('Custom error');
            sinon.stub(fsExtra, 'createReadStream').throws(expectedError);
            let actualError: Error;
            try {
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    pkg: options.pkg,
                    signingPassword: options.signingPassword,
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

            fsExtra.outputFileSync(s`${tempDir}/notReal.pkg`, '<file-contents>');
            //small sleep to ensure the file exists (hack for testing!)
            await util.sleep(10);
            await rokuDeploy.rekeyDevice({
                host: '1.2.3.4',
                password: 'password',
                cwd: rootDir,
                pkg: s`../notReal.pkg`,
                signingPassword: options.signingPassword,
                devId: options.devId
            });
        });

        it('should work with absolute path', async () => {
            let body = `  <div style="display:none">
                <font color="red">Success.</font>
            </div>`;
            mockDoPostRequest(body);
            await rokuDeploy.rekeyDevice({
                host: '1.2.3.4',
                password: 'password',
                pkg: s`${tempDir}/testSignedPackage.pkg`,
                signingPassword: options.signingPassword,
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
                pkg: options.pkg,
                signingPassword: options.signingPassword,
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
                pkg: options.pkg,
                signingPassword: options.signingPassword,
                devId: undefined
            });
        });

        it('should throw error if response is not parsable', async () => {
            try {
                mockDoPostRequest();
                await rokuDeploy.rekeyDevice({
                    host: '1.2.3.4',
                    password: 'password',
                    pkg: options.pkg,
                    signingPassword: options.signingPassword,
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
                    pkg: options.pkg,
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
                    pkg: options.pkg,
                    signingPassword: options.signingPassword,
                    devId: '45fdc2019903ac333ff624b0b2cddd2c733c3e74'
                });
            } catch (e) {
                expect(e).to.be.instanceof(errors.UnknownDeviceResponseError);
                return;
            }
            assert.fail('Exception should have been thrown');
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.rekeyDevice({ pkg: 'test.pkg', signingPassword: 'sign' } as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.rekeyDevice({ pkg: 'test.pkg', signingPassword: 'sign' } as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '<font color="red">Success.</font>' });
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({} as any);
                await rd.rekeyDevice({ pkg: 'test.pkg', signingPassword: 'sign' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '<font color="red">Success.</font>' });
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({} as any);
                await rd.rekeyDevice({ host: 'call-host', pkg: 'test.pkg', signingPassword: 'sign' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('package', () => {
        let onHandler: any;
        beforeEach(() => {
            fsExtra.outputFileSync(`${tempDir}/manifest`, `
                title=RokuDeployTestChannel
                major_version=1
                minor_version=0`);
            sinon.stub(fsExtra, 'ensureDir').callsFake(((pth: string, callback: (err: Error) => void) => {
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

        it('should return an error if there is a problem with the network request', async () => {
            let error = new Error('Network Error');
            try {
                //intercept the post requests
                sinon.stub(request, 'post').callsFake((_, callback) => {
                    process.nextTick(callback, error);
                    return {} as any;
                });
                await rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    manifestPath: s`${tempDir}/manifest`
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
                await rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    manifestPath: s`${tempDir}/manifest`
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
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    manifestPath: s`${tempDir}/manifest`
                }),
                'Invalid Password.'
            );
        });

        it('should return created pkg on success', async () => {
            let body = `var pkgDiv = document.createElement('div');
                        pkgDiv.innerHTML = '<label>Currently Packaged Application:</label><div><font face="Courier"><a href="pkgs//P6953175d5df120c0069c53de12515b9a.pkg">P6953175d5df120c0069c53de12515b9a.pkg</a> <br> package file (7360 bytes)</font></div>';
                        node.appendChild(pkgDiv);`;
            mockDoPostRequest(body);

            const stub = sinon.stub(rokuDeploy as any, 'downloadFile').returns(Promise.resolve('pkgs//P6953175d5df120c0069c53de12515b9a.pkg'));

            let pkgPath = await rokuDeploy.createSignedPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: options.signingPassword,
                out: s`${outDir}/roku-deploy.pkg`,
                manifestPath: s`${tempDir}/manifest`
            });
            expect(pkgPath).to.equal(s`${outDir}/roku-deploy.pkg`);
            expect(stub.getCall(0).args[0].url).to.equal('http://1.2.3.4:80/pkgs//P6953175d5df120c0069c53de12515b9a.pkg');
        });

        it('should return created pkg from SD card on success', async () => {
            mockDoPostRequest(fakePluginPackageResponse);

            const stub = sinon.stub(rokuDeploy as any, 'downloadFile').returns(Promise.resolve());

            let pkgPath = await rokuDeploy.createSignedPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: options.signingPassword,
                manifestPath: s`${tempDir}/manifest`,
                out: s`${outDir}/roku-deploy.pkg`
            });
            expect(pkgPath).to.equal(s`${outDir}/roku-deploy.pkg`);
            expect(stub.getCall(0).args[0].url).to.equal('http://1.2.3.4:80/pkgs/sdcard0/Pae6cec1eab06a45ca1a7f5b69edd3a20.pkg');
        });

        it('should return created pkg from a JSON', async () => {
            let body = `var params = JSON.parse('{"messages":[{"text":"Success.","text_type":"text","type":"success"}],"metadata":{"dev_key":true,"voice_sdk":false},
                        "packages":[{"appType":"channel","fileType":"zip",
                        "pkgPath":"pkgs/P69f2e034f46a57a98bb35d387f22e1f3.pkg"}]}')`;
            mockDoPostRequest(body);

            const stub = sinon.stub(rokuDeploy as any, 'downloadFile').returns(Promise.resolve());

            let pkgPath = await rokuDeploy.createSignedPackage({
                host: '1.2.3.4',
                password: 'password',
                signingPassword: options.signingPassword,
                manifestPath: s`${tempDir}/manifest`,
                out: s`${outDir}/roku-deploy.pkg`
            });
            expect(pkgPath).to.equal(s`${outDir}/roku-deploy.pkg`);
            expect(stub.getCall(0).args[0].url).to.equal('http://1.2.3.4:80/pkgs/P69f2e034f46a57a98bb35d387f22e1f3.pkg');
        });

        it('should return our fallback error if neither error or package link was detected', async () => {
            mockDoPostRequest();
            await expectThrowsAsync(
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    manifestPath: s`${tempDir}/manifest`
                }),
                'Unknown error signing package'
            );
        });

        it('should return error if dev id does not match', async () => {
            mockDoGetRequest(`
                <device-info>
                    <keyed-developer-id>789</keyed-developer-id>
                </device-info>
                `);
            await expectThrowsAsync(
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    devId: '123',
                    manifestPath: s`${tempDir}/manifest`
                }),
                `Package signing cancelled: provided devId '123' does not match on-device devId '789'`
            );
        });

        it('should return error if neither manifestPath nor appTitle and appVersion are provided', async () => {
            await expectThrowsAsync(
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    devId: '123'
                }),
                `Either appTitle and appVersion or manifestPath must be provided`
            );
        });

        it('should return error if major or minor version is missing from manifest', async () => {
            fsExtra.outputFileSync(`${tempDir}/manifest`, `title=AwesomeApp`);
            await expectThrowsAsync(
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    devId: '123',
                    manifestPath: s`${tempDir}/manifest`
                }),
                `Either major or minor version is missing from the manifest`
            );
        });

        it('should return error if value for appTitle is missing from manifest', async () => {
            fsExtra.outputFileSync(`${tempDir}/manifest`, `major_version=1\nminor_version=0`);
            await expectThrowsAsync(
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    devId: '123',
                    manifestPath: s`${tempDir}/manifest`
                }),
                `Value for appTitle is missing from the manifest`
            );
        });

        it('returns a pkg file path on success', async () => {
            //the write stream should return null, which causes a specific branch to be executed
            createWriteStreamStub.callsFake(() => {
                return null;
            });

            // let onHandler: any;
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200
                    });
                }
            };

            let body = `var pkgDiv = document.createElement('div');
                        pkgDiv.innerHTML = '<label>Currently Packaged Application:</label><div><font face="Courier"><a href="pkgs//P6953175d5df120c0069c53de12515b9a.pkg">P6953175d5df120c0069c53de12515b9a.pkg</a> <br> package file (7360 bytes)</font></div>';
                        node.appendChild(pkgDiv);`;
            mockDoPostRequest(body);

            let error: Error;
            try {
                await rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'password',
                    signingPassword: options.signingPassword,
                    manifestPath: s`${tempDir}/manifest`
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

            let body = `var pkgDiv = document.createElement('div');
                        pkgDiv.innerHTML = '<label>Currently Packaged Application:</label><div><font face="Courier"><a href="pkgs//P6953175d5df120c0069c53de12515b9a.pkg">P6953175d5df120c0069c53de12515b9a.pkg</a> <br> package file (7360 bytes)</font></div>';
                        node.appendChild(pkgDiv);`;
            mockDoPostRequest(body);

            await expectThrowsAsync(
                rokuDeploy.createSignedPackage({
                    host: '1.2.3.4',
                    password: 'aaaa',
                    signingPassword: options.signingPassword,
                    manifestPath: s`${tempDir}/manifest`
                }),
                'Some error'
            );
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.createSignedPackage({ signingPassword: 'sign', appTitle: 'test', appVersion: '1.0.0' } as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.createSignedPackage({ signingPassword: 'sign', appTitle: 'test', appVersion: '1.0.0' } as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '<a href="pkgs/package.pkg">' });
                sinon.stub(rd as any, 'downloadFile').resolves();
                await rd.createSignedPackage({ signingPassword: 'sign', appTitle: 'test', appVersion: '1.0.0' } as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '<a href="pkgs/package.pkg">' });
                sinon.stub(rd as any, 'downloadFile').resolves();
                await rd.createSignedPackage({ host: 'call-host', signingPassword: 'sign', appTitle: 'test', appVersion: '1.0.0' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('stage', () => {
        it('should use outDir for staging folder', async () => {
            await rokuDeploy.stage({
                files: [
                    'manifest'
                ],
                rootDir: rootDir
            });
            expectPathExists(`${stagingDir}`);
        });

        it('should support overriding the staging folder', async () => {
            await rokuDeploy.stage({
                files: ['manifest'],
                out: `${tempDir}/custom-out-dir`,
                rootDir: rootDir
            });
            expectPathExists(`${tempDir}/custom-out-dir`);
        });

        it('handles old glob-style', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.stage({
                files: [
                    'manifest',
                    'source/main.brs'
                ],
                rootDir: rootDir,
                out: stagingDir
            });
            expectPathExists(`${stagingDir}/manifest`);
            expectPathExists(`${stagingDir}/source/main.brs`);
        });

        it('handles copying a simple directory by name using src;dest;', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.stage({
                files: [
                    'manifest',
                    {
                        src: 'source/**/*',
                        dest: 'source'
                    }
                ],
                rootDir: rootDir,
                out: stagingDir
            });
            expectPathExists(`${stagingDir}/source/main.brs`);
        });

        it('handles new src;dest style', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.stage({
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
                out: stagingDir
            });
            expectPathExists(`${stagingDir}/manifest`);
            expectPathExists(`${stagingDir}/source/main.brs`);
        });

        it('handles renaming files', async () => {
            writeFiles(rootDir, [
                'manifest',
                'source/main.brs'
            ]);
            await rokuDeploy.stage({
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
                out: stagingDir
            });
            expectPathExists(`${stagingDir}/source/renamed.brs`);
        });

        it('handles absolute src paths', async () => {
            writeFiles(rootDir, [
                'manifest'
            ]);
            await rokuDeploy.stage({
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
                out: stagingDir
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
            await rokuDeploy.stage({
                files: [
                    'manifest',
                    'components/!(scenes)/**/*'
                ],
                rootDir: rootDir,
                out: stagingDir
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
            await rokuDeploy.stage({
                files: [
                    'manifest',
                    'source',
                    'components/**/*',
                    '!components/scenes/**/*'
                ],
                rootDir: rootDir,
                out: stagingDir
            });
            expectPathExists(`${stagingDir}/components/Loader/Loader.brs`);
            expectPathNotExists(`${stagingDir}/components/scenes/Home/Home.brs`);
        });

        it('throws on invalid entries', async () => {
            try {
                await rokuDeploy.stage({
                    files: [
                        'manifest',
                        <any>{}
                    ],
                    rootDir: rootDir,
                    out: stagingDir
                });
                expect(true).to.be.false;
            } catch (e) {
                expect(true).to.be.true;
            }
        });

        it('retains subfolder structure when referencing a folder', async () => {
            fsExtra.outputFileSync(`${rootDir}/flavors/shared/resources/images/fhd/image.jpg`, '');
            await rokuDeploy.stage({
                files: [
                    'manifest',
                    {
                        src: 'flavors/shared/resources/**/*',
                        dest: 'resources'
                    }
                ],
                rootDir: rootDir,
                out: stagingDir
            });
            expectPathExists(`${stagingDir}/resources/images/fhd/image.jpg`);
        });

        it('handles multi-globs subfolder structure', async () => {
            writeFiles(rootDir, [
                'manifest',
                'flavors/shared/resources/images/fhd/image.jpg',
                'resources/image.jpg'
            ]);
            await rokuDeploy.stage({
                files: [
                    'manifest',
                    {
                        //the relative structure after /resources should be retained
                        src: 'flavors/shared/resources/**/*',
                        dest: 'resources'
                    }
                ],
                rootDir: rootDir,
                out: stagingDir
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

                //getFilePaths detects the file
                expect(await rokuDeploy.getFilePaths({ files: ['renamed_test.md'], rootDir: opts.rootDir })).to.eql([{
                    src: s`${opts.rootDir}/renamed_test.md`,
                    dest: s`renamed_test.md`
                }]);

                await rokuDeploy.stage({
                    rootDir: rootDir,
                    out: stagingDir,
                    files: [
                        'manifest',
                        'renamed_test.md'
                    ]
                });
                let stagedFilePath = s`${stagingDir}/renamed_test.md`;
                expectPathExists(stagedFilePath);
                let fileContents = await fsExtra.readFile(stagedFilePath);
                expect(fileContents.toString()).to.equal('hello symlink');
            });

            symlinkIt('copies files from subdirs of symlinked folders', async () => {
                fsExtra.ensureDirSync(s`${tempDir}/baseProject/source/lib/promise`);
                fsExtra.outputFileSync(s`${tempDir}/baseProject/source/lib/lib.brs`, `'lib.brs`);
                fsExtra.outputFileSync(s`${tempDir}/baseProject/source/lib/promise/promise.brs`, `'q.brs`);

                fsExtra.ensureDirSync(s`${tempDir}/mainProject/source`);
                fsExtra.outputFileSync(s`${tempDir}/mainProject/source/main.brs`, `'main.brs`);

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

                //getFilePaths detects the file
                expect(
                    (await rokuDeploy.getFilePaths({ files: opts.files, rootDir: opts.rootDir })).sort((a, b) => a.src.localeCompare(b.src))
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

                await rokuDeploy.stage({
                    files: [
                        'manifest',
                        'source/**/*'
                    ],
                    rootDir: s`${tempDir}/mainProject`
                });
                expect(fsExtra.pathExistsSync(`${stagingDir}/source/lib/promise/promise.brs`));
            });
        });
        it('is resilient to file system errors', async () => {
            let copy = fsExtra.copy;
            let count = 0;

            //mock writeFile so we can throw a few errors during the test
            sinon.stub(fsExtra, 'copy').callsFake((...args) => {
                count += 1;
                //fail a few times
                if (count < 5) {
                    throw new Error('fake error thrown as part of the unit test');
                } else {
                    return copy.apply(fsExtra, args);
                }
            });

            //override the retry milliseconds to make test run faster
            let orig = util.tryRepeatAsync.bind(util);
            sinon.stub(util, 'tryRepeatAsync').callsFake(async (...args) => {
                return orig(args[0], args[1], 0);
            });

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

            await rokuDeploy.stage({
                rootDir: rootDir,
                out: stagingDir,
                files: [
                    'source/main.brs'
                ]
            });
            expectPathExists(s`${stagingDir}/source/main.brs`);
            expect(count).to.be.greaterThan(4);
        });

        it('throws underlying error after the max fs error threshold is reached', async () => {
            let copy = fsExtra.copy;
            let count = 0;

            //mock writeFile so we can throw a few errors during the test
            sinon.stub(fsExtra, 'copy').callsFake((...args) => {
                count += 1;
                //fail a few times
                if (count < 15) {
                    throw new Error('fake error thrown as part of the unit test');
                } else {
                    return copy.apply(fsExtra, args);
                }
            });

            //override the timeout for tryRepeatAsync so this test runs faster
            let orig = util.tryRepeatAsync.bind(util);
            sinon.stub(util, 'tryRepeatAsync').callsFake(async (...args) => {
                return orig(args[0], args[1], 0);
            });

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');
            await expectThrowsAsync(
                rokuDeploy.stage({
                    rootDir: rootDir,
                    out: stagingDir,
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
                util['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>true
                }]);
            }).to.throw();

            expect(() => {
                util['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>false
                }]);
            }).to.throw();

            expect(() => {
                util['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>/asdf/gi
                }]);
            }).to.throw();

            expect(() => {
                util['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>{}
                }]);
            }).to.throw();

            expect(() => {
                util['normalizeFilesArray']([{
                    src: 'some/path',
                    dest: <any>[]
                }]);
            }).to.throw();
        });

        it('normalizes directory separators paths', () => {
            expect(util['normalizeFilesArray']([{
                src: `long/source/path`,
                dest: `long/dest/path`
            }])).to.eql([{
                src: sp`long/source/path`,
                dest: s`long/dest/path`
            }]);
        });

        it('works for simple strings', () => {
            expect(util['normalizeFilesArray']([
                'manifest',
                'source/main.brs'
            ])).to.eql([
                'manifest',
                'source/main.brs'
            ]);
        });

        it('works for negated strings', () => {
            expect(util['normalizeFilesArray']([
                '!.git'
            ])).to.eql([
                '!.git'
            ]);
        });

        it('skips falsey and bogus entries', () => {
            expect(util['normalizeFilesArray']([
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
            expect(util['normalizeFilesArray']([
                {
                    src: 'manifest'
                }
            ])).to.eql([{
                src: 'manifest',
                dest: undefined
            }]);
        });

        it('works for {src:string[]} objects', () => {
            expect(util['normalizeFilesArray']([
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
            expect(util['normalizeFilesArray']([
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
            expect(() => util['normalizeFilesArray'](<any>[true])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[/asdf/])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[new Date()])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[1])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[{ src: true }])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[{ src: /asdf/ }])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[{ src: new Date() }])).to.throw();
            expect(() => util['normalizeFilesArray'](<any>[{ src: 1 }])).to.throw();
        });
    });

    describe('plugin_swup', () => {
        function mockGetDeviceInfo(swVersion: string) {
            sinon.stub(rokuDeploy as any, 'getDeviceInfo').callsFake((params) => {
                return { 'software-version': swVersion };
            });
        }
        it('should send a request to the plugin_swup endpoint for a reboot', async () => {
            mockGetDeviceInfo('15.0.4');
            let stub = mockDoPostRequest();
            let result = await rokuDeploy.rebootDevice({
                host: '1.2.3.4',
                password: 'password'
            });
            expect(result).not.to.be.undefined;
            expect(stub.args[0][0].url).to.include(`/plugin_swup`);
            expect(stub.args[0][0].formData.mysubmit).to.include('Reboot');
        });

        it('should send a request to the plugin_swup endpoint to check for update', async () => {
            mockGetDeviceInfo('15.0.4');
            let stub = mockDoPostRequest();
            let result = await rokuDeploy.checkForUpdate({
                host: '1.2.3.4',
                password: 'password'
            });
            expect(result).not.to.be.undefined;
            expect(stub.args[0][0].url).to.include(`/plugin_swup`);
            expect(stub.args[0][0].formData.mysubmit).to.include('CheckUpdate');
        });

        it('should fail to reboot when sw version is just below minimum (15.0.3)', async () => {
            mockGetDeviceInfo('15.0.3');
            await assertThrowsAsync(async () => {
                await rokuDeploy.rebootDevice({
                    host: '1.2.3.4',
                    password: 'password'
                });
            });
        });

        it('should fail to reboot when software-version is null', async () => {
            mockGetDeviceInfo(null);
            await assertThrowsAsync(async () => {
                await rokuDeploy.rebootDevice({
                    host: '1.2.3.4',
                    password: 'password'
                });
            });
        });

        it('should fail to check for updates when sw version is just below minimum (15.0.3)', async () => {
            mockGetDeviceInfo('15.0.3');
            await assertThrowsAsync(async () => {
                await rokuDeploy.checkForUpdate({
                    host: '1.2.3.4',
                    password: 'password'
                });
            });
        });

        it('should fail to check for updates when software-version is null', async () => {
            mockGetDeviceInfo(null);
            await assertThrowsAsync(async () => {
                await rokuDeploy.checkForUpdate({
                    host: '1.2.3.4',
                    password: 'password'
                });
            });
        });

        describe('rebootDevice constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.rebootDevice({} as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.rebootDevice({} as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                sinon.stub(rd, 'getDeviceInfo').resolves({ 'software-version': '15.0.4' } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '' });
                await rd.rebootDevice({} as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                sinon.stub(rd, 'getDeviceInfo').resolves({ 'software-version': '15.0.4' } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '' });
                await rd.rebootDevice({ host: 'call-host' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });

        describe('checkForUpdate constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.checkForUpdate({} as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.checkForUpdate({} as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                sinon.stub(rd, 'getDeviceInfo').resolves({ 'software-version': '15.0.4' } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '' });
                await rd.checkForUpdate({} as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                sinon.stub(rd, 'getDeviceInfo').resolves({ 'software-version': '15.0.4' } as any);
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '' });
                await rd.checkForUpdate({ host: 'call-host' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('deleteInstalledChannel', () => {
        it('attempts to delete any installed dev channel on the device', async () => {
            mockDoPostRequest();

            let result = await rokuDeploy.deleteDevChannel({
                host: '1.2.3.4',
                password: 'password'
            });
            expect(result).not.to.be.undefined;
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.deleteDevChannel();
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.deleteDevChannel();
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '', response: { statusCode: 200 } });
                await rd.deleteDevChannel();
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '', response: { statusCode: 200 } });
                await rd.deleteDevChannel({ host: 'call-host' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('screenshot', () => {
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
            await expectThrowsAsync(rokuDeploy.captureScreenshot({ host: options.host, password: 'password' }));
        });

        it('throws when there is no response body', async () => {
            // missing body
            mockDoPostRequest(null);
            await expectThrowsAsync(rokuDeploy.captureScreenshot({ host: options.host, password: 'password' }));
        });

        it('throws when there is an empty response body', async () => {
            // empty body
            mockDoPostRequest();
            await expectThrowsAsync(rokuDeploy.captureScreenshot({ host: options.host, password: 'password' }));
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
            await expectThrowsAsync(rokuDeploy.captureScreenshot({ host: options.host, password: 'password' }));
        });

        it('handles the device returning a png', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-png-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: true });
            expect(result.buffer).to.be.instanceOf(Buffer);
            expect(result.filePath).not.to.be.undefined;
            expect(path.extname(result.filePath)).to.equal('.png');
            expect(fsExtra.existsSync(result.filePath));
        });

        it('handles the device returning a jpg', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-jpg-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: true });
            expect(result.buffer).to.be.instanceOf(Buffer);
            expect(result.filePath).not.to.be.undefined;
            expect(path.extname(result.filePath)).to.equal('.jpg');
            expect(fsExtra.existsSync(result.filePath));
        });

        it('take a screenshot from the device and saves to supplied dir', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/myScreenShots/screenshot` });
            expect(result.filePath).not.to.be.undefined;
            expect(util.standardizePath(`${tempDir}/myScreenShots`)).to.equal(path.dirname(result.filePath));
            expect(fsExtra.existsSync(result.filePath));
        });

        it('saves to specified file', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/my` });
            expect(result.filePath).not.to.be.undefined;
            expect(util.standardizePath(tempDir)).to.equal(path.dirname(result.filePath));
            expect(fsExtra.existsSync(path.join(tempDir, 'my')));
        });

        it('saves to specified file ignoring supplied file extension', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/my.jpg` });
            expect(result.filePath).not.to.be.undefined;
            expect(util.standardizePath(tempDir)).to.equal(path.dirname(result.filePath));
            // Without autoExtension, file is saved exactly as specified
            expect(fsExtra.existsSync(path.join(tempDir, 'my.jpg')));
        });

        it('returns buffer without saving to disk when out is not provided', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password' });
            expect(result.buffer).to.be.instanceOf(Buffer);
            expect(result.buffer.toString()).to.equal('fake-image-data');
            expect(result.filePath).to.be.undefined;
        });

        it('saves with user-provided filename exactly when autoExtension is false', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            // With autoExtension: false (default), user-provided filename is used exactly
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/myFile` });
            expect(result.filePath).not.to.be.undefined;
            expect(path.basename(result.filePath)).to.equal('myFile');
            expect(fsExtra.existsSync(result.filePath));
        });

        it('autoExtension: true appends device extension when user filename has no extension', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/myFile`, autoExtension: true });
            expect(result.filePath).not.to.be.undefined;
            expect(path.basename(result.filePath)).to.equal('myFile.jpg');
            expect(fsExtra.existsSync(result.filePath));
        });

        it('autoExtension: true swaps extension when user extension does not match device', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            // User provides .png but device returns .jpg - should swap to .jpg
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/myFile.png`, autoExtension: true });
            expect(result.filePath).not.to.be.undefined;
            expect(path.basename(result.filePath)).to.equal('myFile.jpg');
            expect(fsExtra.existsSync(result.filePath));
        });

        it('autoExtension: true keeps extension when user extension matches device', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.jpg?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/myFile.jpg`, autoExtension: true });
            expect(result.filePath).not.to.be.undefined;
            expect(path.basename(result.filePath)).to.equal('myFile.jpg');
            expect(fsExtra.existsSync(result.filePath));
        });

        it('saves to default temp location when out is true', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: true });
            expect(result.buffer).to.be.instanceOf(Buffer);
            expect(result.filePath).not.to.be.undefined;
            expect(fsExtra.existsSync(result.filePath)).to.be.true;
        });

        it('returns buffer and filePath when out is provided', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            const testImageData = Buffer.from('fake-image-data');
            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 200 });
                } else if (event === 'data') {
                    callback(testImageData);
                } else if (event === 'end') {
                    callback();
                }
            };

            mockDoPostRequest(body);
            let result = await rokuDeploy.captureScreenshot({ host: options.host, password: 'password', out: `${tempDir}/screenshot.png` });
            expect(result.buffer).to.be.instanceOf(Buffer);
            expect(result.buffer.toString()).to.equal('fake-image-data');
            expect(result.filePath).to.equal(path.join(tempDir, 'screenshot.png'));
            expect(fsExtra.existsSync(result.filePath)).to.be.true;
        });

        it('throws error when request fails', async () => {
            let body = getFakeResponseBody(`
                Shell.create('Roku.Message').trigger('Set message type', 'success').trigger('Set message content', 'Screenshot ok').trigger('Render', node);

                var screenshoot = document.createElement('div');
                screenshoot.innerHTML = '<hr /><img src="pkgs/dev.png?time=1649939615">';
                node.appendChild(screenshoot);
            `);

            onHandler = (event, callback) => {
                if (event === 'response') {
                    callback({ statusCode: 500 });
                }
            };

            mockDoPostRequest(body);
            await expectThrowsAsync(rokuDeploy.captureScreenshot({ host: options.host, password: 'password' }));
        });

        describe('constructor defaults', () => {
            it('fails when host not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ password: 'pass' });
                await expectThrowsAsync(async () => {
                    await rd.captureScreenshot({} as any);
                }, 'Missing required option: host');
            });

            it('fails when password not provided in constructor or call', async () => {
                const rd = new RokuDeploy({ host: 'localhost' });
                await expectThrowsAsync(async () => {
                    await rd.captureScreenshot({} as any);
                }, 'Missing required option: password');
            });

            it('uses constructor host when not provided in call', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '<img src="pkgs/dev.jpg?time=1234">' });
                sinon.stub(rd as any, 'downloadToBuffer').resolves(Buffer.from('test'));
                await rd.captureScreenshot({} as any);
                expect(stub.getCall(0).args[0].url).to.include('constructor-host');
            });

            it('call host overrides constructor host', async () => {
                const rd = new RokuDeploy({ host: 'constructor-host', password: 'pass' });
                const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '<img src="pkgs/dev.jpg?time=1234">' });
                sinon.stub(rd as any, 'downloadToBuffer').resolves(Buffer.from('test'));
                await rd.captureScreenshot({ host: 'call-host' } as any);
                expect(stub.getCall(0).args[0].url).to.include('call-host');
            });
        });
    });

    describe('makeZip', () => {
        //this is mainly done to hit 100% coverage, but why not ensure the errors are handled properly? :D
        it('rejects the promise when an error occurs', async () => {
            //zip path doesn't exist
            await assertThrowsAsync(async () => {
                sinon.stub(fsExtra, 'writeFile').callsFake(() => {
                    throw new Error();
                });
                await rokuDeploy['makeZip']('source', '.tmp/some/zip/path/that/does/not/exist');
            });
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
            await rokuDeploy['makeZip'](stagingDir, outputZipPath, ['**/*', '!**/*.map']);

            const data = fsExtra.readFileSync(outputZipPath);
            const zip = await JSZip.loadAsync(data as any);
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

        it('should create zip in proper directory', async () => {
            const outputZipPath = path.join(outDir, 'output.zip');
            await rokuDeploy['makeZip'](rootDir, outputZipPath, ['**/*', '!**/*.map']);
            expectPathExists(outputZipPath);
        });

        it('should only include the specified files', async () => {
            await rokuDeploy.stage({
                files: [
                    'manifest'
                ],
                out: stagingDir,
                rootDir: rootDir
            });

            const zipPath = `${outDir}/roku-deploy.zip`;
            await rokuDeploy.zip({
                dir: stagingDir,
                out: zipPath
            });
            const data = fsExtra.readFileSync(zipPath);
            const zip = await JSZip.loadAsync(data as any);

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
            const zipPath = `${outDir}/roku-deploy.zip`;
            await rokuDeploy.stage({
                files: filePaths,
                out: stagingDir,
                rootDir: rootDir
            });
            await rokuDeploy.zip({
                dir: stagingDir,
                out: zipPath
            });

            const data = fsExtra.readFileSync(zipPath);
            const zip = await JSZip.loadAsync(data as any);

            for (const file of filePaths) {
                const zipFileContents = await zip.file(file.toString())?.async('string');
                const sourcePath = path.join(rootDir, file);
                const incomingContents = fsExtra.readFileSync(sourcePath, 'utf8');
                expect(zipFileContents).to.equal(incomingContents);
            }
        });
    });

    describe('getFilePaths', () => {
        const otherProjectName = 'otherProject';
        const otherProjectDir = sp`${rootDir}/../${otherProjectName}`;
        //create baseline project structure
        beforeEach(() => {
            rokuDeploy = new RokuDeploy();
            options = { rootDir: rootDir } as RokuDeployOptions;
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
            return (await rokuDeploy.getFilePaths({ files: files, rootDir: rootDirOverride }))
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
                expect(await getFilePaths(
                    [
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
                expect(await getFilePaths(
                    [
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
            //dest not specified
            expect(await getFilePaths([{
                src: sp`${cwd}/README.md`
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`README.md`
            }]);

            //dest specified
            expect(await getFilePaths([{
                src: sp`${cwd}/README.md`,
                dest: 'docs/README.md'
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            let paths: any[];

            paths = await getFilePaths([{
                src: sp`${cwd}/README.md`,
                dest: s`docs/README.md`
            }], outDir);

            expect(paths).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            //top-level string paths pointing to files outside the root should thrown an exception
            await expectThrowsAsync(async () => {
                paths = await getFilePaths([
                    sp`${cwd}/README.md`
                ], outDir);
            });
        });

        it('supports relative paths that grab files from outside of the rootDir', async () => {
            writeFiles(`${rootDir}/../`, [
                'README.md'
            ]);
            expect(
                await getFilePaths([{
                    src: sp`../README.md`
                }], rootDir)
            ).to.eql([{
                src: s`${rootDir}/../README.md`,
                dest: s`README.md`
            }]);

            expect(
                await getFilePaths([{
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
                getFilePaths([
                    path.posix.join('..', 'README.md')
                ], outDir)
            );
        });

        it('supports overriding paths', async () => {
            let paths = await getFilePaths([{
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

                fsExtra.outputFileSync(s`${thisRootDir}/source/main.brs`, '');
                fsExtra.outputFileSync(s`${thisRootDir}/components/MainScene.brs`, '');
                fsExtra.outputFileSync(s`${thisRootDir}/components/MainScene.xml`, '');
                fsExtra.outputFileSync(s`${thisRootDir}/../.tmp/MainScene.brs`, '');

                let files = [
                    '**/*.xml',
                    '**/*.brs',
                    {
                        src: '../.tmp/MainScene.brs',
                        dest: 'components/MainScene.brs'
                    }
                ];
                let paths = await getFilePaths(files, thisRootDir);

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
                await getFilePaths([
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
                (await getFilePaths([
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

    describe('parseManifest', () => {
        it('correctly parses valid manifest', async () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, `title=AwesomeApp`);
            let parsedManifest = await rokuDeploy['parseManifest'](`${rootDir}/manifest`);
            expect(parsedManifest.title).to.equal('AwesomeApp');
        });

        it('Throws our error message for a missing file', async () => {
            await expectThrowsAsync(
                rokuDeploy['parseManifest']('invalid-path'),
                `invalid-path does not exist`
            );
        });
    });

    describe('parseManifestFromString', () => {
        it('correctly parses valid manifest', () => {
            let parsedManifest = rokuDeploy['parseManifestFromString'](`
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

    describe('checkRequiredOptions', () => {
        async function testRequiredOptions(action: string, requiredOptions: Partial<RokuDeployOptions>, testedOption: string) {
            const newOptions = { ...requiredOptions };
            delete newOptions[testedOption];
            await expectThrowsAsync(async () => {
                await rokuDeploy[action](newOptions);
            }, `Missing required option: ${testedOption}`);
        }

        it('throws error when sendKeyEvent is missing required options', async () => {
            const requiredOptions: Partial<SendKeyEventOptions> = { host: '1.2.3.4', key: 'up' };
            await testRequiredOptions('sendKeyEvent', requiredOptions, 'host');
            await testRequiredOptions('sendKeyEvent', requiredOptions, 'key');
        });

        it('throws error when sideload is missing required options', async () => {
            const requiredOptions: Partial<SideloadOptions> = { host: '1.2.3.4', password: 'abcd' };
            await testRequiredOptions('sideload', requiredOptions, 'host');
            await testRequiredOptions('sideload', requiredOptions, 'password');
        });

        it('throws error when convertToSquashfs is missing required options', async () => {
            const requiredOptions: Partial<ConvertToSquashfsOptions> = { host: '1.2.3.4', password: 'abcd' };
            await testRequiredOptions('convertToSquashfs', requiredOptions, 'host');
            await testRequiredOptions('convertToSquashfs', requiredOptions, 'password');
        });

        it('throws error when rekeyDevice is missing required options', async () => {
            const requiredOptions: Partial<RekeyDeviceOptions> = { host: '1.2.3.4', password: 'abcd', pkg: 'abcd', signingPassword: 'abcd' };
            await testRequiredOptions('rekeyDevice', requiredOptions, 'host');
            await testRequiredOptions('rekeyDevice', requiredOptions, 'password');
            await testRequiredOptions('rekeyDevice', requiredOptions, 'pkg');
            await testRequiredOptions('rekeyDevice', requiredOptions, 'signingPassword');
        });

        it('throws error when createSignedPackage is missing required options', async () => {
            const requiredOptions: Partial<CreateSignedPackageOptions> = { host: '1.2.3.4', password: 'abcd', signingPassword: 'abcd' };
            await testRequiredOptions('createSignedPackage', requiredOptions, 'host');
            await testRequiredOptions('createSignedPackage', requiredOptions, 'password');
            await testRequiredOptions('createSignedPackage', requiredOptions, 'signingPassword');
        });

        it('throws error when deleteDevChannel is missing required options', async () => {
            const requiredOptions: Partial<DeleteDevChannelOptions> = { host: '1.2.3.4', password: 'abcd' };
            await testRequiredOptions('deleteDevChannel', requiredOptions, 'host');
            await testRequiredOptions('deleteDevChannel', requiredOptions, 'password');
        });

        it('throws error when captureScreenshot is missing required options', async () => {
            const requiredOptions: Partial<CaptureScreenshotOptions> = { host: '1.2.3.4', password: 'abcd' };
            await testRequiredOptions('captureScreenshot', requiredOptions, 'host');
            await testRequiredOptions('captureScreenshot', requiredOptions, 'password');
        });

        it('throws error when getDeviceInfo is missing required options', async () => {
            const requiredOptions: Partial<GetDeviceInfoOptions> = { host: '1.2.3.4' };
            await testRequiredOptions('getDeviceInfo', requiredOptions, 'host');
        });

        it('throws error when getDevId is missing required options', async () => {
            const requiredOptions: Partial<GetDevIdOptions> = { host: '1.2.3.4' };
            await testRequiredOptions('getDevId', requiredOptions, 'host');
        });
    });

    describe('downloadFile', () => {
        it('waits for the write stream to finish writing before resolving', async () => {
            let downloadFileIsResolved = false;

            let requestCalled = defer();
            let onResponse = defer<(res) => any>();

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

            const finalPromise = rokuDeploy['downloadFile']({}, s`${tempDir}/out/something.txt`).then(() => {
                downloadFileIsResolved = true;
            });

            await requestCalled.promise;
            expect(downloadFileIsResolved).to.be.false;

            const callback = await onResponse.promise;
            callback({ statusCode: 200 });
            await util.sleep(10);

            expect(downloadFileIsResolved).to.be.false;

            const writeStream = await writeStreamPromise;
            writeStream.write('test');
            writeStream.close();

            await finalPromise;
            expect(downloadFileIsResolved).to.be.true;
        });
    });

    describe('setUserAgentIfMissing', () => {
        const currentVersion = fsExtra.readJsonSync(`${__dirname}/../package.json`).version;

        it('getUserAgent caches package version', () => {
            const spy = sinon.spy(fsExtra, 'readJsonSync');
            rokuDeploy['_packageVersion'] = undefined;
            expect(rokuDeploy['getUserAgent']()).to.eql(`roku-deploy/${currentVersion}`);
            expect(rokuDeploy['getUserAgent']()).to.eql(`roku-deploy/${currentVersion}`);

            expect(spy.callCount).to.equal(1);
        });

        it('getUserAgent caches failed package.json read', () => {
            const stub = sinon.stub(fsExtra, 'readJsonSync').throws(new Error('Unable to read package.json'));
            rokuDeploy['_packageVersion'] = undefined;
            expect(rokuDeploy['getUserAgent']()).to.eql(`roku-deploy/unknown`);
            expect(rokuDeploy['getUserAgent']()).to.eql(`roku-deploy/unknown`);

            expect(stub.callCount).to.equal(1);
            rokuDeploy['_packageVersion'] = null;
        });

        it('currentVersion is valid', () => {
            expect(currentVersion).to.exist.and.to.match(/^\d+\.\d+\.\d+.*/);
        });

        it('works when params is undefined', () => {
            //undefined
            expect(
                rokuDeploy['setUserAgentIfMissing'](undefined)
            ).to.eql({ headers: { 'User-Agent': `roku-deploy/${currentVersion}` } });
        });

        it('works when params has no header container', () => {
            expect(
                rokuDeploy['setUserAgentIfMissing']({} as any)
            ).to.eql({ headers: { 'User-Agent': `roku-deploy/${currentVersion}` } });
        });

        it('works when params has empty header container', () => {
            expect(
                rokuDeploy['setUserAgentIfMissing']({} as any)
            ).to.eql({ headers: { 'User-Agent': `roku-deploy/${currentVersion}` } });
        });

        it('works when params has existing header container with no user agent', () => {
            expect(
                rokuDeploy['setUserAgentIfMissing']({ headers: {} } as any)
            ).to.eql({ headers: { 'User-Agent': `roku-deploy/${currentVersion}` } });
        });

        it('works when params has existing header container with user agent', () => {
            expect(
                rokuDeploy['setUserAgentIfMissing']({ headers: { 'User-Agent': 'some-other-user-agent' } } as any)
            ).to.eql({ headers: { 'User-Agent': 'some-other-user-agent' } });
        });

        it('works when we fail to load package version', () => {
            sinon.stub(fsExtra, 'readJsonSync').throws(new Error('Unable to read package.json'));
            rokuDeploy['_packageVersion'] = undefined;
            expect(
                rokuDeploy['setUserAgentIfMissing']({} as any)
            ).to.eql({ headers: { 'User-Agent': 'roku-deploy/unknown' } });
        });
    });

    describe('isUpdateCheckRequiredResponse', () => {
        it('matches on actual response from device', () => {
            const response = `<html>\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"HandheldFriendly\" content=\"True\">\n  <title> Roku Development Kit </title>\n\n  <link rel=\"stylesheet\" type=\"text/css\" media=\"screen\" href=\"css/global.css\" />\n</head>\n<body>\n  <div id=\"root\" style=\"background: #fff\">\n\n  </div>\n\n  <script type=\"text/javascript\" src=\"css/global.js\"></script>\n  <script type=\"text/javascript\">\n  \n      // Include core components and resounce bundle (needed)\n      Shell.resource.set(null, {\n          endpoints: {} \n      });\n      Shell.create('Roku.Event.Key');\n      Shell.create('Roku.Events.Resize');\n      Shell.create('Roku.Events.Scroll');  \n      // Create global navigation and render it\n      var nav = Shell.create('Roku.Nav')\n        .trigger('Enable standalone and utility mode - hide user menu, shopping cart, and etc.')\n        .trigger('Use compact footer')\n        .trigger('Hide footer')\n        .trigger('Render', document.getElementById('root'))\n        .trigger('Remove all feature links from header')\n\n      // Retrieve main content body node\n      var node = nav.invoke('Get main body section mounting node');\n      \n      // Create page container and page header\n      var container = Shell.create('Roku.Nav.Page.Standard').trigger('Render', node);\n      node = container.invoke('Get main body node');\n      container.invoke('Get headline node').innerHTML = 'Failed to check for software update';\n\t  // Cannot reach Software Update Server\n      node.innerHTML = '<p>Please make sure that your Roku device is connected to internet and running most recent software.</p> <p> After connecting to internet, go to system settings and check for software update.</p> ';\n\n      var hrDiv = document.createElement('div');\n      hrDiv.innerHTML = '<hr />';\n      node.appendChild(hrDiv);\n\n      var d = document.createElement('div');\n      d.innerHTML = '<br />';\n      node.appendChild(d);\n\n  </script>\n\n\n  <div style=\"display:none\">\n\n  <font color=\"red\">Please make sure that your Roku device is connected to internet, and running most recent software version (d=953108)</font>\n\n  </div>\n\n</body>\n</html>\n`;
            expect(
                rokuDeploy['isUpdateCheckRequiredResponse'](response)
            ).to.be.true;
        });

        it('matches with some variations to the message', () => {
            const response = `"   FAILED    tocheck\tfor softwareupdate"`;
            expect(
                rokuDeploy['isUpdateCheckRequiredResponse'](response)
            ).to.be.true;
        });
    });

    describe('isUpdateRequiredError', () => {
        it('returns true if the status code is 577', () => {
            expect(
                rokuDeploy['isUpdateRequiredError']({ details: { httpDetails: { response: { statusCode: 577 } } } })
            ).to.be.true;
        });

        it('returns true if the body is an update response from device', () => {
            const response = `<html>\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"HandheldFriendly\" content=\"True\">\n  <title> Roku Development Kit </title>\n\n  <link rel=\"stylesheet\" type=\"text/css\" media=\"screen\" href=\"css/global.css\" />\n</head>\n<body>\n  <div id=\"root\" style=\"background: #fff\">\n\n  </div>\n\n  <script type=\"text/javascript\" src=\"css/global.js\"></script>\n  <script type=\"text/javascript\">\n  \n      // Include core components and resounce bundle (needed)\n      Shell.resource.set(null, {\n          endpoints: {} \n      });\n      Shell.create('Roku.Event.Key');\n      Shell.create('Roku.Events.Resize');\n      Shell.create('Roku.Events.Scroll');  \n      // Create global navigation and render it\n      var nav = Shell.create('Roku.Nav')\n        .trigger('Enable standalone and utility mode - hide user menu, shopping cart, and etc.')\n        .trigger('Use compact footer')\n        .trigger('Hide footer')\n        .trigger('Render', document.getElementById('root'))\n        .trigger('Remove all feature links from header')\n\n      // Retrieve main content body node\n      var node = nav.invoke('Get main body section mounting node');\n      \n      // Create page container and page header\n      var container = Shell.create('Roku.Nav.Page.Standard').trigger('Render', node);\n      node = container.invoke('Get main body node');\n      container.invoke('Get headline node').innerHTML = 'Failed to check for software update';\n\t  // Cannot reach Software Update Server\n      node.innerHTML = '<p>Please make sure that your Roku device is connected to internet and running most recent software.</p> <p> After connecting to internet, go to system settings and check for software update.</p> ';\n\n      var hrDiv = document.createElement('div');\n      hrDiv.innerHTML = '<hr />';\n      node.appendChild(hrDiv);\n\n      var d = document.createElement('div');\n      d.innerHTML = '<br />';\n      node.appendChild(d);\n\n  </script>\n\n\n  <div style=\"display:none\">\n\n  <font color=\"red\">Please make sure that your Roku device is connected to internet, and running most recent software version (d=953108)</font>\n\n  </div>\n\n</body>\n</html>\n`;
            expect(
                rokuDeploy['isUpdateRequiredError']({ details: { httpDetails: { response: { statusCode: 500, body: response } } } })
            ).to.be.true;
        });

        it('returns false on missing details', () => {
            expect(
                rokuDeploy['isUpdateRequiredError']({})
            ).to.be.false;
        });

        it('returns false on missing httpDetails', () => {
            expect(
                rokuDeploy['isUpdateRequiredError']({ details: {} })
            ).to.be.false;
        });

        it('returns false on missing status code', () => {
            expect(
                rokuDeploy['isUpdateRequiredError']({ details: { httpDetails: { response: {} } } })
            ).to.be.false;
        });

        it('returns false on non-string missing body', () => {
            expect(
                rokuDeploy['isUpdateRequiredError']({ details: { httpDetails: { response: { statusCode: 500, body: false } } } })
            ).to.be.false;
        });
    });

    describe('getInstalledPackages', () => {
        it('sends the dcl_enabled qs flag', async () => {
            const stub = mockDoGetRequest();
            sinon.stub(rokuDeploy as any, 'getPackagesFromResponseBody').returns([]);
            const result = await rokuDeploy['getInstalledPackages']({ host: 'localhost', password: 'test' } as any);
            expect(stub.getCall(0).args[0].qs.dcl_enabled).to.eql('1');
            expect(result).to.eql([]);
        });

        it('augments if qs is already defined', async () => {
            sinon.stub(rokuDeploy as any, 'generateBaseRequestOptions').returns({
                qs: {
                    existing: 'value'
                }
            } as any);
            const stub = mockDoGetRequest();
            sinon.stub(rokuDeploy as any, 'getPackagesFromResponseBody').returns([]);
            const result = await rokuDeploy['getInstalledPackages']({ host: 'localhost', password: 'test' } as any);
            expect(stub.getCall(0).args[0].qs).to.eql({
                existing: 'value',
                dcl_enabled: '1'
            });
            expect(result).to.eql([]);
        });

        it('properly parses the response', async () => {
            const stub = mockDoGetRequest(`
                var params = JSON.parse('{"messages":null,"metadata":{"dev_id":"12345","dev_key":true,"voice_sdk":false},"packages":[{"appType":"channel","archiveFileName":"roku-deploy.zip","fileType":"zip","id":"0","location":"nvram","md5":"a8d2f9974e2736174c1033b8a7183288","pkgPath":"","size":"2267547"}]}');
            `);
            const result = await rokuDeploy['getInstalledPackages']({ host: 'localhost', password: 'test' } as any);
            expect(stub.getCall(0).args[0].qs.dcl_enabled).to.eql('1');
            expect(result).to.eql([{
                appType: 'channel',
                archiveFileName: 'roku-deploy.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: 'a8d2f9974e2736174c1033b8a7183288',
                pkgPath: '',
                size: '2267547'
            }]);
        });

        it('handles when packages is not an array', async () => {
            mockDoGetRequest(`
                var params = JSON.parse('{"messages":null,"metadata":{"dev_id":"12345","dev_key":true,"voice_sdk":false},"packages": 123}');
            `);
            const result = await rokuDeploy['getInstalledPackages']({ host: 'localhost', password: 'test' } as any);
            expect(result).to.eql([]);
        });

        it('handles when the item is not an object', async () => {
            mockDoGetRequest(`
                var params = JSON.parse('123');
            `);
            const result = await rokuDeploy['getInstalledPackages']({ host: 'localhost', password: 'test' } as any);
            expect(result).to.eql([]);
        });
    });

    describe('deleteComponentLibrary', () => {
        it('does not crash if qs is undefined', async () => {
            const stub = mockDoPostRequest();

            sinon.stub(rokuDeploy as any, 'generateBaseRequestOptions').returns({} as any);
            await rokuDeploy.deleteComponentLibrary({ host: 'localhost', password: 'test', fileName: 'test.zip' } as any);

            expect(stub.getCall(0).args[0].qs.dcl_enabled).to.eql('1');
        });

        it('augments if qs is already defined', async () => {
            sinon.stub(rokuDeploy as any, 'generateBaseRequestOptions').returns({
                qs: {
                    existing: 'value'
                }
            } as any);
            const stub = mockDoPostRequest();

            await rokuDeploy.deleteComponentLibrary({ host: 'localhost', password: 'test', fileName: 'test.zip' } as any);

            expect(stub.getCall(0).args[0].qs).to.eql({
                existing: 'value',
                dcl_enabled: '1'
            });
        });

        it('deletes the component library', async () => {
            options.failOnCompileError = true;
            options.remoteDebug = true;
            options.remoteDebugConnectEarly = true;
            const stub = mockDoPostRequest();

            await rokuDeploy.deleteComponentLibrary({
                host: '0.0.0.0',
                password: 'aaaa',
                fileName: 'fakeFile.zip'
            });

            //ensure we're sending the correct form inputs
            expect(stub.getCall(0).args[0].formData).to.eql({
                mysubmit: 'Delete',
                app_type: 'dcl',
                fileName: 'fakeFile.zip'
            });
            //also set the query string parameter that enables DCL behaviors (this seems to be important as well for some reason...)
            expect(stub.getCall(0).args[0].qs.dcl_enabled).to.eql('1');
        });
    });

    describe('deleteAllComponentLibraries', () => {
        it('sends no requests if there are no DCLs to delete', async () => {
            //return 0 packages
            sinon.stub(rokuDeploy as any, 'getInstalledPackages').returns(Promise.resolve([]));
            const stub = sinon.stub(rokuDeploy, 'deleteComponentLibrary').returns(Promise.resolve());
            await rokuDeploy.deleteAllComponentLibraries({} as any);
            expect(stub.called).to.be.false;
        });

        it('sends no requests if there are no DCLs to delete', async () => {
            //return 1 channel package
            sinon.stub(rokuDeploy as any, 'getInstalledPackages').returns(Promise.resolve([{
                appType: 'channel',
                archiveFileName: 'roku-deploy.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: 'a8d2f9974e2736174c1033b8a7183288',
                pkgPath: '',
                size: '2267547'
            }]));
            const stub = sinon.stub(rokuDeploy, 'deleteComponentLibrary').returns(Promise.resolve());
            await rokuDeploy.deleteAllComponentLibraries({} as any);
            expect(stub.called).to.be.false;
        });

        it('sends single request if only have one DCL to delete', async () => {
            //return 1 channel package
            sinon.stub(rokuDeploy as any, 'getInstalledPackages').returns(Promise.resolve([{
                appType: 'channel',
                archiveFileName: 'roku-deploy.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: 'a8d2f9974e2736174c1033b8a7183288',
                pkgPath: '',
                size: '2267547'
            }, {
                appType: 'dcl',
                archiveFileName: 'lib.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: '7221a9bfb63be42f4fc6b0de22584af6',
                pkgPath: '',
                size: '1231'
            }]));
            const stub = sinon.stub(rokuDeploy, 'deleteComponentLibrary').returns(Promise.resolve());
            await rokuDeploy.deleteAllComponentLibraries({} as any);
            expect(stub.getCall(0).args[0]).to.eql({
                fileName: 'lib.zip'
            });
        });

        it('sends one request for each DCL', async () => {
            //return 1 channel package
            sinon.stub(rokuDeploy as any, 'getInstalledPackages').returns(Promise.resolve([{
                appType: 'dcl',
                archiveFileName: 'lib1.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: '7221a9bfb63be42f4fc6b0de22584af6',
                pkgPath: '',
                size: '1231'
            }, {
                appType: 'channel',
                archiveFileName: 'roku-deploy.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: 'a8d2f9974e2736174c1033b8a7183288',
                pkgPath: '',
                size: '226754'
            }, {
                appType: 'dcl',
                archiveFileName: 'lib2.zip',
                fileType: 'zip',
                id: '0',
                location: 'nvram',
                md5: '7221a9bfb63be42f4fc6b0de22584af6',
                pkgPath: '',
                size: '1231'
            }]));
            const stub = sinon.stub(rokuDeploy, 'deleteComponentLibrary').returns(Promise.resolve());
            await rokuDeploy.deleteAllComponentLibraries({} as any);
            expect(stub.getCalls().map(x => x.args)).to.eql([
                [{
                    fileName: 'lib1.zip'
                }],
                [{
                    fileName: 'lib2.zip'
                }]
            ]);
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

    describe('defaults', () => {
        describe('constructor defaults', () => {
            describe('host option', () => {
                it('fails when not provided in constructor or call', async () => {
                    const rd = new RokuDeploy();
                    await expectThrowsAsync(async () => {
                        await rd['sendKeyEvent']({ key: 'home', action: 'keypress' } as any);
                    }, 'Missing required option: host');
                });

                it('uses constructor value when not provided in call', async () => {
                    const rd = new RokuDeploy({ host: 'constructor-host' });
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                    await rd['sendKeyEvent']({ key: 'home', action: 'keypress' } as any);
                    expect(stub.getCall(0).args[0].url).to.include('constructor-host');
                });

                it('uses call value when not provided in constructor', async () => {
                    const rd = new RokuDeploy();
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                    await rd['sendKeyEvent']({ host: 'call-host', key: 'home', action: 'keypress' });
                    expect(stub.getCall(0).args[0].url).to.include('call-host');
                });

                it('call value overrides constructor value', async () => {
                    const rd = new RokuDeploy({ host: 'constructor-host' });
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                    await rd['sendKeyEvent']({ host: 'call-host', key: 'home', action: 'keypress' });
                    expect(stub.getCall(0).args[0].url).to.include('call-host');
                });
            });

            describe('password option', () => {
                it('fails when not provided in constructor or call', async () => {
                    const rd = new RokuDeploy();
                    await expectThrowsAsync(async () => {
                        await rd.deleteDevChannel({ host: 'localhost' } as any);
                    }, 'Missing required option: password');
                });

                it('uses constructor value when not provided in call', async () => {
                    const rd = new RokuDeploy({ host: 'localhost', password: 'constructor-pass' });
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '', response: { statusCode: 200 } });
                    await rd.deleteDevChannel();
                    expect(stub.getCall(0).args[0].auth.pass).to.equal('constructor-pass');
                });

                it('call value overrides constructor value', async () => {
                    const rd = new RokuDeploy({ host: 'localhost', password: 'constructor-pass' });
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({ body: '', response: { statusCode: 200 } });
                    await rd.deleteDevChannel({ password: 'call-pass' } as any);
                    expect(stub.getCall(0).args[0].auth.pass).to.equal('call-pass');
                });
            });

            describe('ecpPort option', () => {
                it('uses static default when not provided anywhere', async () => {
                    const rd = new RokuDeploy();
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                    await rd['sendKeyEvent']({ host: 'localhost', key: 'home', action: 'keypress' });
                    expect(stub.getCall(0).args[0].url).to.include(':8060/');
                });

                it('uses constructor value when not provided in call', async () => {
                    const rd = new RokuDeploy({ ecpPort: 9000 });
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                    await rd['sendKeyEvent']({ host: 'localhost', key: 'home', action: 'keypress' });
                    expect(stub.getCall(0).args[0].url).to.include(':9000/');
                });

                it('call value overrides constructor value', async () => {
                    const rd = new RokuDeploy({ ecpPort: 9000 });
                    const stub = sinon.stub(rd as any, 'doPostRequest').resolves({});
                    await rd['sendKeyEvent']({ host: 'localhost', key: 'home', action: 'keypress', ecpPort: 9999 });
                    expect(stub.getCall(0).args[0].url).to.include(':9999/');
                });
            });

            describe('packagePort option', () => {
                it('uses static default when not provided anywhere', () => {
                    const rd = new RokuDeploy();
                    const result = rd['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test' });
                    expect(result.url).to.include(':80/');
                });

                it('uses constructor value when not provided in call', () => {
                    const rd = new RokuDeploy({ packagePort: 8080 });
                    const result = rd['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test' });
                    expect(result.url).to.include(':8080/');
                });

                it('call value overrides constructor value', () => {
                    const rd = new RokuDeploy({ packagePort: 8080 });
                    const result = rd['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test', packagePort: 9090 });
                    expect(result.url).to.include(':9090/');
                });
            });

            describe('logger option', () => {
                it('uses global logger when not provided in constructor', () => {
                    const rd = new RokuDeploy();
                    expect(rd.logger).to.exist;
                });

                it('uses custom logger when provided in constructor', () => {
                    const customLogger = {
                        logLevel: 'off' as any,
                        log: sinon.stub(),
                        info: sinon.stub(),
                        warn: sinon.stub(),
                        debug: sinon.stub(),
                        error: sinon.stub(),
                        trace: sinon.stub()
                    };
                    const rd = new RokuDeploy({ logger: customLogger as any });
                    expect(rd.logger).to.equal(customLogger);
                });

                it('allows setting logLevel on logger after construction', () => {
                    const rd = new RokuDeploy();
                    rd.logger.logLevel = 'debug';
                    expect(rd.logger.logLevel).to.equal('debug');
                });
            });

        });

        describe('loadConfigFile', () => {
            it('should fill in options from rokudeploy.json', () => {
                fsExtra.outputJsonSync(s`${rootDir}/rokudeploy.json`, { password: 'password' });
                expect(
                    rokuDeploy.loadConfigFile({ cwd: rootDir })
                ).to.eql({
                    password: 'password'
                });
            });

            it('loads cwd from process', () => {
                try {
                    fsExtra.outputJsonSync(s`${process.cwd()}/rokudeploy.json`, { host: '1.2.3.4' });
                    expect(
                        rokuDeploy.loadConfigFile()
                    ).to.eql({
                        host: '1.2.3.4'
                    });
                } finally {
                    fsExtra.removeSync(s`${process.cwd()}/rokudeploy.json`);
                }
            });

            it('catches invalid json with jsonc parser', () => {
                fsExtra.writeJsonSync(s`${process.cwd()}/rokudeploy.json`, { host: '1.2.3.4' });
                sinon.stub(fsExtra, 'readFileSync').returns(`
                    {
                        "rootDir": "src"
                `);
                let ex;
                try {
                    rokuDeploy.loadConfigFile();
                } catch (e) {
                    ex = e;
                }
                expect(ex).to.exist;
                expect(ex.message.startsWith('Error parsing')).to.be.true;
                fsExtra.removeSync(s`${process.cwd()}/rokudeploy.json`);
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
                let loadedOptions = rokuDeploy.loadConfigFile();
                expect(loadedOptions.stagingDir.endsWith('staging-dir')).to.be.true;
            });

            it('supports jsonc for rokudeploy.json', () => {
                fsExtra.writeFileSync(s`${tempDir}/rokudeploy.json`, `
                    //leading comment
                    {
                        //inner comment
                        "rootDir": "src" //trailing comment
                    }
                    //trailing comment
                `);
                let loadedOptions = rokuDeploy.loadConfigFile({ cwd: tempDir });
                expect(loadedOptions.rootDir).to.equal('src');
            });

            it('returns empty object when config file does not exist', () => {
                const result = rokuDeploy.loadConfigFile({ cwd: '/nonexistent/path' });
                expect(result).to.eql({});
            });
        });

        describe('generateBaseRequestOptions', () => {
            it('uses default timeout', () => {
                const result = rokuDeploy['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test' });
                expect(result.timeout).to.equal(RokuDeploy['defaults'].timeout);
            });

            it('uses default packagePort', () => {
                const result = rokuDeploy['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test' });
                expect(result.url).to.equal(`http://localhost:${RokuDeploy['defaults'].packagePort}/test`);
            });

            it('uses default username of rokudev', () => {
                const result = rokuDeploy['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test' });
                expect(result.auth.user).to.equal('rokudev');
            });

            it('allows overriding timeout', () => {
                const result = rokuDeploy['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test', timeout: 5000 });
                expect(result.timeout).to.equal(5000);
            });

            it('allows overriding packagePort', () => {
                const result = rokuDeploy['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test', packagePort: 8080 });
                expect(result.url).to.equal('http://localhost:8080/test');
            });

            it('allows overriding username', () => {
                const result = rokuDeploy['generateBaseRequestOptions']('test', { host: 'localhost', password: 'test', username: 'admin' });
                expect(result.auth.user).to.equal('admin');
            });
        });

        describe('sendKeyEvent', () => {
            it('uses default ecpPort', async () => {
                const stub = sinon.stub(rokuDeploy as any, 'doPostRequest').resolves({});
                await rokuDeploy['sendKeyEvent']({ host: 'localhost', key: 'home', action: 'keypress' });
                expect(stub.getCall(0).args[0].url).to.include(`:${RokuDeploy['defaults'].ecpPort}/`);
            });

            it('uses default timeout', async () => {
                const stub = sinon.stub(rokuDeploy as any, 'doPostRequest').resolves({});
                await rokuDeploy['sendKeyEvent']({ host: 'localhost', key: 'home', action: 'keypress' });
                expect(stub.getCall(0).args[0].timeout).to.equal(RokuDeploy['defaults'].timeout);
            });

            it('allows overriding ecpPort', async () => {
                const stub = sinon.stub(rokuDeploy as any, 'doPostRequest').resolves({});
                await rokuDeploy['sendKeyEvent']({ host: 'localhost', key: 'home', action: 'keypress', ecpPort: 9000 });
                expect(stub.getCall(0).args[0].url).to.include(':9000/');
            });
        });

        describe('getDeviceInfo', () => {
            it('uses default ecpPort', async () => {
                const stub = sinon.stub(rokuDeploy as any, 'doGetRequest').resolves({ body: '<device-info></device-info>' });
                sinon.stub(util, 'dnsLookup').resolves('localhost');
                try {
                    await rokuDeploy.getDeviceInfo({ host: 'localhost' });
                } catch (e) {
                    // ignore parse errors
                }
                expect(stub.getCall(0).args[0].url).to.include(`:${RokuDeploy['defaults'].ecpPort}/`);
            });

            it('uses default timeout', async () => {
                const stub = sinon.stub(rokuDeploy as any, 'doGetRequest').resolves({ body: '<device-info></device-info>' });
                sinon.stub(util, 'dnsLookup').resolves('localhost');
                try {
                    await rokuDeploy.getDeviceInfo({ host: 'localhost' });
                } catch (e) {
                    // ignore parse errors
                }
                expect(stub.getCall(0).args[0].timeout).to.equal(RokuDeploy['defaults'].timeout);
            });
        });

        describe('stage', () => {
            it('uses default rootDir of ./', async () => {
                // stage uses rootDir ?? './' which resolves to cwd
                const currentDir = process.cwd();
                writeFiles(currentDir, ['manifest']);
                try {
                    const result = await rokuDeploy.stage({ out: stagingDir });
                    // If it doesn't throw, it found the manifest in cwd (default rootDir)
                    expect(result).to.equal(stagingDir);
                } finally {
                    await fsExtra.remove(`${currentDir}/manifest`);
                }
            });

            it('uses default outDir for staging', async () => {
                writeFiles(rootDir, ['manifest']);
                const result = await rokuDeploy.stage({ rootDir: rootDir });
                expect(result).to.equal(s`${process.cwd()}/${RokuDeploy['defaults'].outDir}/.roku-deploy-staging`);
            });
        });

        describe('zip', () => {
            it('uses default outDir and outFile for zip path', async () => {
                writeFiles(stagingDir, ['manifest']);
                const zipSpy = sinon.spy(rokuDeploy as any, 'makeZip');
                await rokuDeploy.zip({ dir: stagingDir });
                const outPath = zipSpy.getCall(0).args[1];
                expect(outPath).to.equal(s`${process.cwd()}/${RokuDeploy['defaults'].outDir}/${RokuDeploy['defaults'].outFile}`);
            });
        });

        describe('sideload', () => {
            it('uses default deleteDevChannel of true', async () => {
                const deleteStub = sinon.stub(rokuDeploy, 'deleteDevChannel').resolves();
                sinon.stub(rokuDeploy, 'closeChannel').resolves();
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({ on: (event, cb) => cb() } as any);
                mockDoPostRequest('success');

                await rokuDeploy.sideload({ host: 'localhost', password: 'test', zip: 'test.zip' });
                expect(deleteStub.called).to.be.true;
            });

            it('allows disabling deleteDevChannel', async () => {
                const deleteStub = sinon.stub(rokuDeploy, 'deleteDevChannel').resolves();
                sinon.stub(rokuDeploy, 'closeChannel').resolves();
                sinon.stub(fsExtra, 'pathExists').resolves(true);
                sinon.stub(fsExtra, 'createReadStream').returns({ on: (event, cb) => cb() } as any);
                mockDoPostRequest('success');

                await rokuDeploy.sideload({ host: 'localhost', password: 'test', zip: 'test.zip', deleteDevChannel: false });
                expect(deleteStub.called).to.be.false;
            });
        });
    });

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

const fakePluginPackageResponse = `
<!--
(c) 2019-2023 Roku, Inc.  All content herein is protected by U.S.
copyright and other applicable intellectual property laws and may not be
copied without the express permission of Roku, Inc., which reserves all
rights.  Reuse of any of this content for any purpose without the
permission of Roku, Inc. is strictly prohibited.
-->

<html>
<head>
  <meta charset="utf-8">
  <meta name="HandheldFriendly" content="True">
  <title> Roku Development Kit </title>
  <link rel="stylesheet" type="text/css" media="screen" href="css/global.css" />
</head>
<body>
  <div id="root" style="background: #fff">
  </div>

  <div style="display:none">
</div>
  <div style="display:none">
<a href="pkgs//Pae6cec1eab06a45ca1a7f5b69edd3a20.pkg">Pae6cec1eab06a45ca1a7f5b69edd3a20.pkg</a></div>

  <script type="text/javascript" src="css/global.js"></script>
  <script type="text/javascript" src="js/common.js"></script>
  <script type="text/javascript">
    document.addEventListener("DOMContentLoaded", function (event) {
      var params = JSON.parse('{"messages":null,"metadata":{"dev_id":"85ad433fddab9079e6cc378e736544c21e1f7123","dev_key":true,"voice_sdk":false},"packages":[{"appType":"channel","archiveFileName":"some-package.zip","fileType":"zip","id":"0","location":"sdcard","md5":"da4a98f08d45aea6e14a481ff481ffbe","pkgPath":"pkgs/sdcard0/Pae6cec1eab06a45ca1a7f5b69edd3a20.pkg","size":"455694"}]}');
      var hasPackage = params.packages.length > 0;
  </script>
</body>
</html>
`;
