import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { WriteStream, ReadStream } from 'fs-extra';
import * as r from 'postman-request';
import type * as requestType from 'request';
const request = r as typeof requestType;
import * as JSZip from 'jszip';
import * as errors from './Errors';
import * as xml2js from 'xml2js';
import type { ParseError } from 'jsonc-parser';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import { util } from './util';
import type { RokuDeployOptions, FileEntry } from './RokuDeployOptions';
import { Logger, LogLevel } from './Logger';
import * as dayjs from 'dayjs';
import * as lodash from 'lodash';
import type { DeviceInfo, DeviceInfoRaw } from './DeviceInfo';

export class RokuDeploy {

    constructor() {
        this.logger = new Logger();
    }

    private logger: Logger;

    //this should just
    // public screenshotDir = path.join(tempDir, '/roku-deploy/screenshots/');

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async stage(options: StageOptions) {
        options = this.getOptions(options) as any;

        //clean the staging directory
        await fsExtra.remove(options.stagingDir);

        //make sure the staging folder exists
        await fsExtra.ensureDir(options.stagingDir);
        // await this.copyToStaging(options.files, options.stagingDir, options.rootDir);

        if (!options.stagingDir) {
            throw new Error('stagingPath is required');
        }
        if (!await fsExtra.pathExists(options.rootDir)) {
            throw new Error(`rootDir does not exist at "${options.rootDir}"`);
        }

        let fileObjects = await util.getFilePaths(options.files, options.rootDir);
        //copy all of the files
        await Promise.all(fileObjects.map(async (fileObject) => {
            let destFilePath = util.standardizePath(`${options.stagingDir}/${fileObject.dest}`);

            //make sure the containing folder exists
            await fsExtra.ensureDir(path.dirname(destFilePath));

            //sometimes the copyfile action fails due to race conditions (normally to poorly constructed src;dest; objects with duplicate files in them
            await util.tryRepeatAsync(async () => {
                //copy the src item using the filesystem
                await fsExtra.copy(fileObject.src, destFilePath, {
                    //copy the actual files that symlinks point to, not the symlinks themselves
                    dereference: true
                });
            }, 10);
        }));
        return options.stagingDir;
    }

    /**
     * Given an already-populated staging folder, create a zip archive of it and copy it to the output folder
     * @param options
     */
    public async zip(options: ZipPackageOptions) {
        options = this.getOptions(options) as any;

        //make sure the output folder exists
        await fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options as any);

        //ensure the manifest file exists in the staging folder
        if (!await util.fileExistsCaseInsensitive(`${options.stagingDir}/manifest`)) {
            throw new Error(`Cannot zip package: missing manifest file in "${options.stagingDir}"`);
        }

        //create a zip of the staging folder
        await this.__makeZip(options.stagingDir, zipFilePath);
    }

    /**
     * Given a path to a folder, zip up that folder and all of its contents
     * @param srcFolder the folder that should be zipped
     * @param zipFilePath the path to the zip that will be created
     * @param preZipCallback a function to call right before every file gets added to the zip
     * @param files a files array used to filter the files from `srcFolder`
     */
    private async __makeZip(srcFolder: string, zipFilePath: string, preFileZipCallback?: (file: StandardizedFileEntry, data: Buffer) => Buffer, files: FileEntry[] = ['**/*']) {
        const filePaths = await util.getFilePaths(files, srcFolder);

        const zip = new JSZip();
        // Allows us to wait until all are done before we build the zip
        const promises = [];
        for (const file of filePaths) {
            const promise = fsExtra.readFile(file.src).then((data) => {
                if (preFileZipCallback) {
                    data = preFileZipCallback(file, data);
                }

                const ext = path.extname(file.dest).toLowerCase();
                let compression = 'DEFLATE';

                if (ext === '.jpg' || ext === '.png' || ext === '.jpeg') {
                    compression = 'STORE';
                }
                zip.file(file.dest.replace(/[\\/]/g, '/'), data, {
                    compression: compression
                });
            });
            promises.push(promise);
        }
        await Promise.all(promises);
        // level 2 compression seems to be the best balance between speed and file size. Speed matters more since most will be calling squashfs afterwards.
        const content = await zip.generateAsync({ type: 'nodebuffer', compressionOptions: { level: 2 } });
        return fsExtra.writeFile(zipFilePath, content);
    }

    private generateBaseRequestOptions<T>(requestPath: string, options: BaseRequestOptions, formData = {} as T): requestType.OptionsWithUrl {
        options = this.getOptions(options) as any;
        let url = `http://${options.host}:${options.packagePort}/${requestPath}`;
        let baseRequestOptions = {
            url: url,
            timeout: options.timeout,
            auth: {
                user: options.username,
                pass: options.password,
                sendImmediately: false
            },
            formData: formData,
            agentOptions: { 'keepAlive': false }
        };
        return baseRequestOptions;
    }

    public async keypress(options: { key: string }) {
        return this.sendKeyEvent({
            ...options,
            action: 'keypress'
        });
    }

    public async keyup(options: any) {
        return this.sendKeyEvent({
            ...options,
            action: 'keyup'
        });
    }

    public async keydown(options: any) {
        return this.sendKeyEvent({
            ...options,
            action: 'keydown'
        });
    }

    public async sendText(options: any) {
        const chars = options.text.split('');
        for (const char of chars) {
            await this.keypress({
                ...options,
                key: `lit_${char}`
            });
        }
    }

    /**
     * Simulate pressing the home button on the remote for this roku.
     * This makes the roku return to the home screen
     * @param host - the host
     * @param port - the port that should be used for the request. defaults to 8060
     * @param timeout - request timeout duration in milliseconds. defaults to 150000
     */
    private async sendKeyEvent(options: { host: string; port?: string; key: 'home' | 'left' | 'all.the.others'; action: 'keypress' | 'keyup' | 'keydown'; timeout?: number }) {
        let options = this.getOptions();
        port = port ? port : options.remotePort;
        timeout = timeout ? timeout : options.timeout;
        // press the home button to return to the main screen
        return this.doPostRequest({
            url: `http://${host}:${port}/keypress/Home`,
            timeout: timeout
        }, false);
    }

    public async closeChannel(options: CloseAppOptions) {
        //TODO

        //if supports ecp close-app, then do that (twice so it kills instant resume)
        //else, send home press
    }

    /**
     * Publish a pre-existing packaged zip file to a remote Roku.
     * @param options
     */
    public async sideload(options: PublishOptions): Promise<{ message: string; results: any }> {
        options = this.getOptions(options) as any;
        if (!options.host) {
            throw new errors.MissingRequiredOptionError('must specify the host for the Roku device');
        }
        //make sure the outDir exists
        await fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options as any);

        if (options.deleteInstalledChannel) {
            try {
                await this.deleteDevChannel(options);
            } catch (e) {
                // note we don't report the error; as we don't actually care that we could not deploy - it's just useless noise to log it.
            }
        }

        let readStream: ReadStream;
        try {
            if ((await fsExtra.pathExists(zipFilePath)) === false) {
                throw new Error(`Cannot publish because file does not exist at '${zipFilePath}'`);
            }
            readStream = fsExtra.createReadStream(zipFilePath);
            //wait for the stream to open (no harm in doing this, and it helps solve an issue in the tests)
            await new Promise((resolve) => {
                readStream.on('open', resolve);
            });

            let requestOptions = this.generateBaseRequestOptions('plugin_install', options as any, {
                mysubmit: 'Replace',
                archive: readStream
            });

            //attach the remotedebug flag if configured
            if (options.remoteDebug) {
                requestOptions.formData.remotedebug = '1';
            }

            //attach the remotedebug_connect_early if present
            if (options.remoteDebugConnectEarly) {
                // eslint-disable-next-line camelcase
                requestOptions.formData.remotedebug_connect_early = '1';
            }

            //try to "replace" the channel first since that usually works.
            let response: HttpResponse;
            try {
                response = await this.doPostRequest(requestOptions);
            } catch (replaceError: any) {
                //fail if this is a compile error
                if (this.isCompileError(replaceError.message) && options.failOnCompileError) {
                    throw new errors.CompileError('Compile error', replaceError, replaceError.results);
                } else {
                    requestOptions.formData.mysubmit = 'Install';
                    response = await this.doPostRequest(requestOptions);
                }
            }

            if (options.failOnCompileError) {
                if (this.isCompileError(response.body)) {
                    throw new errors.CompileError('Compile error', response, this.getRokuMessagesFromResponseBody(response.body));
                }
            }

            if (response.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                return { message: 'Identical to previous version -- not replacing', results: response };
            }
            return { message: 'Successful deploy', results: response };
        } finally {
            //delete the zip file only if configured to do so
            if (options.retainDeploymentArchive === false) {
                await fsExtra.remove(zipFilePath);
            }
            //try to close the read stream to prevent files becoming locked
            try {
                readStream?.close();
            } catch (e) {
                this.logger.info('Error closing read stream', e);
            }
        }
    }

    /**
     * Does the response look like a compile error
     */
    private isCompileError(responseHtml: string) {
        return !!/install\sfailure:\scompilation\sfailed/i.exec(responseHtml);
    }

    /**
     * Converts the currently sideloaded dev app to squashfs for faster loading packages
     * @param options
     */
    public async convertToSquashfs(options: ConvertToSquashfsOptions) {
        options = this.getOptions(options) as any;
        if (!options.host) {
            throw new errors.MissingRequiredOptionError('must specify the host for the Roku device');
        }
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options as any, {
            archive: '',
            mysubmit: 'Convert to squashfs'
        });

        let results = await this.doPostRequest(requestOptions);
        if (results.body.indexOf('Conversion succeeded') === -1) {
            throw new errors.ConvertError('Squashfs conversion failed');
        }
    }

    /**
     * resign Roku Device with supplied pkg and
     * @param options
     */
    public async rekeyDevice(options: RekeyDeviceOptions) {
        options = this.getOptions(options) as any;
        if (!options.rekeySignedPackage) {
            throw new errors.MissingRequiredOptionError('Must supply rekeySignedPackage');
        }

        if (!options.signingPassword) {
            throw new errors.MissingRequiredOptionError('Must supply signingPassword');
        }

        let rekeySignedPackagePath = options.rekeySignedPackage;
        if (!path.isAbsolute(options.rekeySignedPackage)) {
            rekeySignedPackagePath = path.join(options.rootDir, options.rekeySignedPackage);
        }
        let requestOptions = this.generateBaseRequestOptions('plugin_inspect', options as any, {
            mysubmit: 'Rekey',
            passwd: options.signingPassword,
            archive: null as ReadStream
        });

        let results: HttpResponse;
        try {
            requestOptions.formData.archive = fsExtra.createReadStream(rekeySignedPackagePath);
            results = await this.doPostRequest(requestOptions);
        } finally {
            //ensure the stream is closed
            try {
                requestOptions.formData.archive?.close();
            } catch { }
        }

        let resultTextSearch = /<font color="red">([^<]+)<\/font>/.exec(results.body);
        if (!resultTextSearch) {
            throw new errors.UnparsableDeviceResponseError('Unknown Rekey Failure');
        }

        if (resultTextSearch[1] !== 'Success.') {
            throw new errors.FailedDeviceResponseError('Rekey Failure: ' + resultTextSearch[1]);
        }

        if (options.devId) {
            let devId = await this.getDevId(options);

            if (devId !== options.devId) {
                throw new errors.UnknownDeviceResponseError('Rekey was successful but resulting Dev ID "' + devId + '" did not match expected value of "' + options.devId + '"');
            }
        }
    }

    /**
     * Sign a pre-existing package using Roku and return path to retrieve it
     * @param options
     */
    public async createSignedPackage(options: CreateSignedPackageOptions): Promise<string> {
        options = this.getOptions(options) as any;
        if (!options.signingPassword) {
            throw new errors.MissingRequiredOptionError('Must supply signingPassword');
        }
        let manifestPath = path.join(options.stagingDir, 'manifest');
        let parsedManifest = await this.parseManifest(manifestPath);
        let appName = parsedManifest.title + '/' + parsedManifest.major_version + '.' + parsedManifest.minor_version;

        //prevent devId mismatch (if devId is specified)
        if (options.devId && options.devId !== await this.getDevId()) {
            throw new Error('devId mismatch. nope, not gonna sign');
        }

        let requestOptions = this.generateBaseRequestOptions('plugin_package', options as any, {
            mysubmit: 'Package',
            pkg_time: (new Date()).getTime(), //eslint-disable-line camelcase
            passwd: options.signingPassword,
            app_name: appName //eslint-disable-line camelcase
        });

        let results = await this.doPostRequest(requestOptions);

        let failedSearchMatches = /<font.*>Failed: (.*)/.exec(results.body);
        if (failedSearchMatches) {
            throw new errors.FailedDeviceResponseError(failedSearchMatches[1], results);
        }

        let pkgSearchMatches = /<a href="(pkgs\/[^\.]+\.pkg)">/.exec(results.body);
        if (pkgSearchMatches) {
            const url = pkgSearchMatches[1];
            options = this.getOptions(options) as any;
            let requestOptions2 = this.generateBaseRequestOptions(url, options);

            let pkgFilePath = this.getOutputPkgFilePath(options as any);
            return this.getToFile(requestOptions2, pkgFilePath);
        }

        throw new errors.UnknownDeviceResponseError('Unknown error signing package', results);
    }

    /**
     * Centralized function for handling POST http requests
     * @param params
     */
    private async doPostRequest(params: any, verify = true) {
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {
            request.post(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        if (verify) {
            this.checkRequest(results);
        }
        return results as HttpResponse;
    }

    /**
     * Centralized function for handling GET http requests
     * @param params
     */
    private async doGetRequest(params: requestType.OptionsWithUrl) {
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {
            request.get(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        this.checkRequest(results);
        return results as HttpResponse;
    }

    private checkRequest(results) {
        if (!results || !results.response || typeof results.body !== 'string') {
            throw new errors.UnparsableDeviceResponseError('Invalid response', results);
        }

        if (results.response.statusCode === 401) {
            throw new errors.UnauthorizedDeviceResponseError('Unauthorized. Please verify username and password for target Roku.', results);
        }

        let rokuMessages = this.getRokuMessagesFromResponseBody(results.body);

        if (rokuMessages.errors.length > 0) {
            throw new errors.FailedDeviceResponseError(rokuMessages.errors[0], rokuMessages);
        }

        if (results.response.statusCode !== 200) {
            throw new errors.InvalidDeviceResponseCodeError('Invalid response code: ' + results.response.statusCode, results);
        }
    }

    private getRokuMessagesFromResponseBody(body: string): RokuMessages {
        const result = {
            errors: [] as string[],
            infos: [] as string[],
            successes: [] as string[]
        };
        let errorRegex = /Shell\.create\('Roku\.Message'\)\.trigger\('[\w\s]+',\s+'(\w+)'\)\.trigger\('[\w\s]+',\s+'(.*?)'\)/igm;
        let match: RegExpExecArray;

        while ((match = errorRegex.exec(body))) {
            let [, messageType, message] = match;
            switch (messageType.toLowerCase()) {
                case RokuMessageType.error:
                    if (!result.errors.includes(message)) {
                        result.errors.push(message);
                    }
                    break;

                case RokuMessageType.info:
                    if (!result.infos.includes(message)) {
                        result.infos.push(message);
                    }
                    break;

                case RokuMessageType.success:
                    if (!result.successes.includes(message)) {
                        result.successes.push(message);
                    }
                    break;

                default:
                    break;
            }
        }

        let jsonParseRegex = /JSON\.parse\(('.+')\);/igm;
        let jsonMatch: RegExpExecArray;

        while ((jsonMatch = jsonParseRegex.exec(body))) {
            let [, jsonString] = jsonMatch;
            let jsonObject = parseJsonc(jsonString);
            if (typeof jsonObject === 'object' && !Array.isArray(jsonObject) && jsonObject !== null) {
                let messages = jsonObject.messages;

                if (!Array.isArray(messages)) {
                    continue;
                }

                for (let messageObject of messages) {
                    // Try to duck type the object to make sure it is some form of message to be displayed
                    if (typeof messageObject.type === 'string' && messageObject.text_type === 'text' && typeof messageObject.text === 'string') {
                        const messageType: string = messageObject.type;
                        const text: string = messageObject.text;
                        switch (messageType.toLowerCase()) {
                            case RokuMessageType.error:
                                if (!result.errors.includes(text)) {
                                    result.errors.push(text);
                                }
                                break;

                            case RokuMessageType.info:
                                if (!result.infos.includes(text)) {
                                    result.infos.push(text);
                                }
                                break;

                            case RokuMessageType.success:
                                if (!result.successes.includes(text)) {
                                    result.successes.push(text);
                                }

                                break;

                            default:
                                break;
                        }
                    }
                }
            }

        }

        return result;
    }

    /**
     * Deletes any installed dev channel on the target Roku device
     * @param options
     */
    public async deleteDevChannel(options?: DeleteDevChannelOptions) {
        options = this.getOptions(options) as any;

        let deleteOptions = this.generateBaseRequestOptions('plugin_install', options as any);
        deleteOptions.formData = {
            mysubmit: 'Delete',
            archive: ''
        };
        return this.doPostRequest(deleteOptions);
    }

    /**
     * Gets a screenshot from the device. A side-loaded channel must be running or an error will be thrown.
     */
    public async captureScreenshot(options: TakeScreenshotOptions) {
        options.outDir = options.outDir ?? this.screenshotDir;
        options.outFile = options.outFile ?? `screenshot-${dayjs().format('YYYY-MM-DD-HH.mm.ss.SSS')}`;
        let saveFilePath: string;

        // Ask for the device to make an image
        let createScreenshotResult = await this.doPostRequest({
            ...this.generateBaseRequestOptions('plugin_inspect', options as any),
            formData: {
                mysubmit: 'Screenshot',
                archive: ''
            }
        });

        // Pull the image url out of the response body
        const [_, imageUrlOnDevice, imageExt] = /["'](pkgs\/dev(\.jpg|\.png)\?.+?)['"]/gi.exec(createScreenshotResult.body) ?? [];

        if (imageUrlOnDevice) {
            saveFilePath = util.standardizePath(path.join(options.outDir, options.outFile + imageExt));
            await this.getToFile(
                this.generateBaseRequestOptions(imageUrlOnDevice, options),
                saveFilePath
            );
        } else {
            throw new Error('No screen shot url returned from device');
        }
        return saveFilePath;
    }

    private async getToFile(requestParams: any, filePath: string) {
        let writeStream: WriteStream;
        await fsExtra.ensureFile(filePath);
        return new Promise<string>((resolve, reject) => {
            writeStream = fsExtra.createWriteStream(filePath, {
                flags: 'w'
            });
            if (!writeStream) {
                reject(new Error(`Unable to create write stream for "${filePath}"`));
                return;
            }
            //when the file has finished writing to disk, we can finally resolve and say we're done
            writeStream.on('finish', () => {
                resolve(filePath);
            });
            //if anything does wrong with the write stream, reject the promise
            writeStream.on('error', (error) => {
                reject(error);
            });

            request.get(requestParams).on('error', (err) => {
                reject(err);
            }).on('response', (response) => {
                if (response.statusCode !== 200) {
                    return reject(new Error('Invalid response code: ' + response.statusCode));
                }
            }).pipe(writeStream);

        }).finally(() => {
            try {
                writeStream.close();
            } catch { }
        });
    }

    /**
     * Get an options with all overridden vaues, and then defaults for missing values
     * @param options
     */
    private __getOptions(options: RokuDeployOptions = {}) {
        let fileOptions: RokuDeployOptions = {};

        let defaultOptions = <RokuDeployOptions>{
            outDir: './out',
            outFile: 'roku-deploy',
            stagingDir: `./out/.roku-deploy-staging`,
            retainDeploymentArchive: true,
            incrementBuildNumber: false,
            failOnCompileError: true,
            deleteDevChannel: true,
            packagePort: 80,
            remotePort: 8060,
            timeout: 150000,
            rootDir: './',
            files: [...DefaultFiles],
            username: 'rokudev',
            logLevel: LogLevel.log
        };

        //override the defaults with any found or provided options
        let finalOptions = { ...defaultOptions, ...fileOptions, ...options };
        this.logger.logLevel = finalOptions.logLevel;

        //fully resolve the folder paths
        finalOptions.rootDir = path.resolve(process.cwd(), finalOptions.rootDir);
        finalOptions.outDir = path.resolve(process.cwd(), finalOptions.outDir);

        let stagingDir = finalOptions.stagingDir || finalOptions.stagingFolderPath;

        //stagingDir
        if (options.stagingDir) {
            finalOptions.stagingDir = path.resolve(options.cwd, options.stagingDir);
        } else {
            finalOptions.stagingDir = path.resolve(
                process.cwd(),
                util.standardizePath(`${finalOptions.outDir}/.roku-deploy-staging`)
            );
        }

        return finalOptions;
    }

    /**
     * Centralizes getting output zip file path based on passed in options
     * @param options
     */
    private getOutputZipFilePath(options?: GetOutputZipFilePathOptions) {
        options = this.getOptions(options) as any;

        let zipFileName = options.outFile;
        if (!zipFileName.toLowerCase().endsWith('.zip')) {
            zipFileName += '.zip';
        }
        let outFolderPath = path.resolve(options.outDir);

        let outZipFilePath = path.join(outFolderPath, zipFileName);
        return outZipFilePath;
    }

    /**
     * Centralizes getting output pkg file path based on passed in options
     * @param options
     */
    private getOutputPkgFilePath(options?: GetOutputPkgFilePathOptions) {
        options = this.getOptions(options) as any;

        let pkgFileName = options.outFile;
        if (pkgFileName.toLowerCase().endsWith('.zip')) {
            pkgFileName = pkgFileName.replace('.zip', '.pkg');
        } else {
            pkgFileName += '.pkg';
        }
        let outFolderPath = path.resolve(options.outDir);

        let outPkgFilePath = path.join(outFolderPath, pkgFileName);
        return outPkgFilePath;
    }

    /**
     * Get the `device-info` response from a Roku device
     * @param host the host or IP address of the Roku
     * @param port the port to use for the ECP request (defaults to 8060)
     */
    public async getDeviceInfo(options?: { enhance: true } & GetDeviceInfoOptions): Promise<DeviceInfo>;
    public async getDeviceInfo(options?: GetDeviceInfoOptions): Promise<DeviceInfoRaw>
    public async getDeviceInfo(options: GetDeviceInfoOptions) {
        options = this.getOptions(options) as any;

        //if the host is a DNS name, look up the IP address
        try {
            options.host = await util.dnsLookup(options.host);
        } catch (e) {
            //try using the host as-is (it'll probably fail...)
        }

        const url = `http://${options.host}:${options.remotePort}/query/device-info`;

        let response = await this.doGetRequest({
            url: url,
            timeout: options.timeout,
            headers: {
                'User-Agent': 'https://github.com/RokuCommunity/roku-deploy'
            }
        });
        try {
            const parsedContent = await xml2js.parseStringPromise(response.body, {
                explicitArray: false
            });
            // clone the data onto an object because xml2js somehow makes this object not an object???
            let deviceInfo = {
                ...parsedContent['device-info']
            } as Record<string, any>;

            if (options.enhance) {
                const result = {};
                // sanitize/normalize values to their native formats, and also convert property names to camelCase
                for (let key in deviceInfo) {
                    result[lodash.camelCase(key)] = this.normalizeDeviceInfoFieldValue(deviceInfo[key]);
                }
                deviceInfo = result;
            }
            return deviceInfo;
        } catch (e) {
            throw new errors.UnparsableDeviceResponseError('Could not retrieve device info', response);
        }
    }

    /**
     * Normalize a deviceInfo field value. This includes things like converting boolean strings to booleans, number strings to numbers,
     * decoding HtmlEntities, etc.
     * @param deviceInfo
     */
    private normalizeDeviceInfoFieldValue(value: any) {
        let num: number;
        // convert 'true' and 'false' string values to boolean
        if (value === 'true') {
            return true;
        } else if (value === 'false') {
            return false;
        } else if (value.trim() !== '' && !isNaN(num = Number(value))) {
            return num;
        } else {
            return util.decodeHtmlEntities(value);
        }
    }

    /**
     * TODO we might delete this one. let chris think about it. ;)
     * @param options
     * @returns
     */
    public async getDevId(options?: GetDevIdOptions) {
        const deviceInfo = await this.getDeviceInfo(options);
        return deviceInfo['keyed-developer-id'];
    }

    /**
     * TODO move these manifest functions to a util somewhere
     */
    private async parseManifest(manifestPath: string): Promise<ManifestData> {
        if (!await fsExtra.pathExists(manifestPath)) {
            throw new Error(manifestPath + ' does not exist');
        }

        let manifestContents = await fsExtra.readFile(manifestPath, 'utf-8');
        return this.parseManifestFromString(manifestContents);
    }

    /**
     * TODO move these manifest functions to a util somewhere
     */
    private parseManifestFromString(manifestContents: string): ManifestData {
        let manifestLines = manifestContents.split('\n');
        let manifestData: ManifestData = {};
        manifestData.keyIndexes = {};
        manifestData.lineCount = manifestLines.length;
        manifestLines.forEach((line, index) => {
            let match = /(\w+)=(.+)/.exec(line);
            if (match) {
                let key = match[1];
                manifestData[key] = match[2];
                manifestData.keyIndexes[key] = index;
            }
        });

        return manifestData;
    }

    /**
     * TODO move these manifest functions to a util somewhere
     */
    public stringifyManifest(manifestData: ManifestData): string {
        let output = [];

        if (manifestData.keyIndexes && manifestData.lineCount) {
            output.fill('', 0, manifestData.lineCount);

            let key;
            for (key in manifestData) {
                if (key === 'lineCount' || key === 'keyIndexes') {
                    continue;
                }

                let index = manifestData.keyIndexes[key];
                output[index] = `${key}=${manifestData[key]}`;
            }
        } else {
            output = Object.keys(manifestData).map((key) => {
                return `${key}=${manifestData[key]}`;
            });
        }

        return output.join('\n');
    }
}

export interface ManifestData {
    [key: string]: any;
    keyIndexes?: Record<string, number>;
    lineCount?: number;
}

export interface BeforeZipCallbackInfo {
    /**
     * Contains an associative array of the parsed values in the manifest
     */
    manifestData: ManifestData;
    /**
     * The directory where the files were staged
     */
    stagingDir: string;
}

export interface StandardizedFileEntry {
    /**
     * The full path to the source file
     */
    src: string;
    /**
     * The path relative to the root of the pkg to where the file should be placed
     */
    dest: string;
}

export interface RokuMessages {
    errors: string[];
    infos: string[];
    successes: string[];
}

enum RokuMessageType {
    success = 'success',
    info = 'info',
    error = 'error'
}

export const DefaultFiles = [
    'source/**/*.*',
    'components/**/*.*',
    'images/**/*.*',
    'manifest'
];

export interface HttpResponse {
    response: any;
    body: any;
}

export interface TakeScreenshotOptions {
    /**
     * The IP address or hostname of the target Roku device.
     * @example '192.168.1.21'
     */
    host: string;

    /**
     * The password for logging in to the developer portal on the target Roku device
     */
    password: string;

    /**
     * A full path to the folder where the screenshots should be saved.
     * Will use the OS temp directory by default
     */
    outDir?: string;

    /**
     * The base filename the image file should be given (excluding the extension)
     * The default format looks something like this: screenshot-YYYY-MM-DD-HH.mm.ss.SSS.<jpg|png>
     */
    outFile?: string;
}

export interface GetDeviceInfoOptions {
    /**
     * The hostname or IP address to use for the device-info URL
     */
    host: string;
    /**
     * The port to use to send the device-info request (defaults to the standard 8060 ECP port)
     */
    remotePort?: number;
    /**
     * The number of milliseconds at which point this request should timeout and return a rejected promise
     */
    timeout?: number;
    /**
     * Should the device-info be enhanced by camel-casing the property names and converting boolean strings to booleans and number strings to numbers?
     * @default false
     */
    enhance?: boolean;
}

export interface StageOptions {
    rootDir?: string;
    files?: FileEntry[];
    stagingDir?: string;
    retainStagingDir?: boolean;
}

export interface ZipPackageOptions {
    stagingDir?: string;
    outDir?: string;
}

export interface PublishOptions {
    host: string;
    password: string;
    remoteDebug?: boolean;
    remoteDebugConnectEarly?: boolean;
    failOnCompileError?: boolean;
    retainDeploymentArchive?: boolean;
    outDir?: string;
    outFile?: string;
}

export interface BaseRequestOptions {
    host: string;
    packagePort?: number;
    timeout?: number;
    username?: string;
    password: string;
}

export interface ConvertToSquashfsOptions {
    host: string;
    password: string;
}

export interface RekeyDeviceOptions {
    host: string;
    password: string;
    rekeySignedPackage: string;
    signingPassword: string;
    rootDir?: string;
    devId: string;
}

export interface CreateSignedPackageOptions {
    host: string;
    password: string;
    signingPassword: string;
    stagingDir?: string;
    /**
     * If specified, signing will fail if the device's devId is different than this value
     */
    devId?: string;
}

export interface DeleteDevChannelOptions {
    host: string;
    password: string;
}

export interface GetOutputZipFilePathOptions {
    outFile?: string;
    outDir?: string;
}

export interface DeployOptions {
    host: string;
    password: string;
    files?: FileEntry[];
    rootDir?: string;
    stagingDir?: string;
    deleteDevChannel?: boolean;
    outFile?: string;
    outDir?: string;
}

export interface GetOutputPkgFilePathOptions {
    outFile?: string;
    outDir?: string;
}

export interface GetDevIdOptions {
    host: string;
    /**
     * The port to use to send the device-info request (defaults to the standard 8060 ECP port)
     */
    remotePort?: number;
    /**
     * The number of milliseconds at which point this request should timeout and return a rejected promise
     */
    timeout?: number;
}
