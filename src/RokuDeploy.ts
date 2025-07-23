import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { WriteStream, ReadStream } from 'fs-extra';
import * as r from 'postman-request';
import type * as requestType from 'request';
const request = r as typeof requestType;
import * as JSZip from 'jszip';
import * as errors from './Errors';
import * as xml2js from 'xml2js';
import { parse as parseJsonc } from 'jsonc-parser';
import { util } from './util';
import type { RokuDeployOptions, FileEntry } from './RokuDeployOptions';
import { logger } from '@rokucommunity/logger';
import * as dayjs from 'dayjs';
import * as lodash from 'lodash';
import type { DeviceInfo, DeviceInfoRaw } from './DeviceInfo';
import * as tempDir from 'temp-dir';

export class RokuDeploy {
    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async stage(options: StageOptions) {
        logger.info('Beginning to copy files to staging folder');
        options = this.getOptions(options) as any;

        //clean the staging directory
        await fsExtra.remove(options.stagingDir);

        //make sure the staging folder exists
        await fsExtra.ensureDir(options.stagingDir);

        if (!await fsExtra.pathExists(options.rootDir)) {
            throw new Error(`rootDir does not exist at "${options.rootDir}"`);
        }

        let fileObjects = await this.getFilePaths(options.files, options.rootDir);
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
        logger.info('Relevant files copied to:', options.stagingDir);
        return options.stagingDir;
    }

    /**
     * Given an already-populated staging folder, create a zip archive of it and copy it to the output folder
     * @param options
     */
    public async zip(options: ZipOptions) {
        logger.info('Beginning to zip staging folder');
        options = this.getOptions(options) as any;

        let zipFilePath = this.getOutputZipFilePath(options as any);

        //ensure the manifest file exists in the staging folder
        if (!await util.fileExistsCaseInsensitive(`${options.stagingDir}/manifest`)) {
            throw new Error(`Cannot zip package: missing manifest file in "${options.stagingDir}"`);
        }

        //create a zip of the staging folder
        await this.makeZip(options.stagingDir, zipFilePath);
        logger.info('Zip created at:', zipFilePath);
    }

    /**
     * Given a path to a folder, zip up that folder and all of its contents
     * @param srcFolder the folder that should be zipped
     * @param zipFilePath the path to the zip that will be created
     * @param files a files array used to filter the files from `srcFolder`
     */
    private async makeZip(srcFolder: string, zipFilePath: string, files: FileEntry[] = ['**/*']) {
        const filePaths = await this.getFilePaths(files, srcFolder);

        const zip = new JSZip();
        // Allows us to wait until all are done before we build the zip
        const promises = [];
        for (const file of filePaths) {
            const promise = fsExtra.readFile(file.src).then((data) => {
                const ext = path.extname(file.dest).toLowerCase();
                let compression: 'DEFLATE' | 'STORE' = 'DEFLATE';

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

        //ensure the outDir exists
        await fsExtra.ensureDir(
            path.dirname(zipFilePath)
        );
        // level 2 compression seems to be the best balance between speed and file size. Speed matters more since most will be calling squashfs afterwards.
        const content = await zip.generateAsync({ type: 'nodebuffer', compressionOptions: { level: 2 } });
        return fsExtra.writeFile(zipFilePath, content);
    }

    /**
    * Get all file paths for the specified options
    * @param files
    * @param rootFolderPath - the absolute path to the root dir where relative files entries are relative to
    */
    public async getFilePaths(files: FileEntry[], rootDir: string): Promise<StandardizedFileEntry[]> {
        //if the rootDir isn't absolute, convert it to absolute using the standard options flow
        if (path.isAbsolute(rootDir) === false) {
            rootDir = this.getOptions({ rootDir: rootDir }).rootDir;
        }
        const entries = util.normalizeFilesArray(files);
        const srcPathsByIndex = await util.globAllByIndex(
            entries.map(x => {
                return typeof x === 'string' ? x : x.src;
            }),
            rootDir
        );

        /**
         * Result indexed by the dest path
         */
        let result = new Map<string, StandardizedFileEntry>();

        //compute `dest` path for every file
        for (let i = 0; i < srcPathsByIndex.length; i++) {
            const srcPaths = srcPathsByIndex[i];
            const entry = entries[i];
            if (srcPaths) {
                for (let srcPath of srcPaths) {
                    srcPath = util.standardizePath(srcPath);

                    const dest = util.computeFileDestPath(srcPath, entry, rootDir);
                    //the last file with this `dest` will win, so just replace any existing entry with this one.
                    result.set(dest, {
                        src: srcPath,
                        dest: dest
                    });
                }
            }
        }
        return [...result.values()];
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

    public async keyPress(options: KeyPressOptions) {
        return this.sendKeyEvent({
            ...options,
            key: options.key,
            action: 'keypress'
        });
    }

    public async keyUp(options: KeyUpOptions) {
        return this.sendKeyEvent({
            ...options,
            action: 'keyup'
        });
    }

    public async keyDown(options: KeyDownOptions) {
        return this.sendKeyEvent({
            ...options,
            action: 'keydown'
        });
    }

    public async sendText(options: SendTextOptions) {
        const chars = options.text.split('');
        for (const char of chars) {
            await this.sendKeyEvent({
                ...options,
                key: `lit_${encodeURIComponent(char)}`,
                action: 'keypress'
            });
        }
    }

    /**
     * Simulate pressing the home button on the remote for this roku.
     * This makes the roku return to the home screen
     */
    private async sendKeyEvent(options: SendKeyEventOptions) {
        logger.info('Sending key event:', options.key);
        this.checkRequiredOptions(options, ['host', 'key']);
        let filledOptions = this.getOptions(options);
        // press the home button to return to the main screen
        return this.doPostRequest({
            url: `http://${filledOptions.host}:${filledOptions.remotePort}/${filledOptions.action}/${filledOptions.key}`,
            timeout: filledOptions.timeout
        }, false);
    }

    public async closeChannel(options: CloseChannelOptions) {
        // TODO: After 13.0 releases, add check for ECP close-app support, and use that twice to kill instant resume if available
        await this.sendKeyEvent({
            ...options,
            action: 'keypress',
            key: 'home'
        });
    }

    /**
     * Publish a pre-existing packaged zip file to a remote Roku.
     * @param options
     */
    public async sideload(options: SideloadOptions): Promise<{ message: string; results: any }> {
        logger.info('Beggining to sideload package');
        this.checkRequiredOptions(options, ['host', 'password']);
        options = this.getOptions(options) as any;
        //make sure the outDir exists
        await fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options as any);

        if (options.deleteDevChannel) {
            try {
                await this.deleteDevChannel(options);
            } catch (e) {
                // note we don't report the error; as we don't actually care that we could not deploy - it's just useless noise to log it.
            }
        }

        let readStream: ReadStream;
        try {
            if ((await fsExtra.pathExists(zipFilePath)) === false) {
                throw new Error(`Cannot sideload because file does not exist at '${zipFilePath}'`);
            }
            readStream = fsExtra.createReadStream(zipFilePath);
            //wait for the stream to open (no harm in doing this, and it helps solve an issue in the tests)
            await new Promise((resolve) => {
                readStream.on('open', resolve);
            });

            const route = options.packageUploadOverrides?.route ?? 'plugin_install';
            let requestOptions = this.generateBaseRequestOptions(route, options, {
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

            //apply any supplied formData overrides
            for (const key in options.packageUploadOverrides?.formData ?? {}) {
                const value = options.packageUploadOverrides.formData[key];
                if (value === undefined || value === null) {
                    delete requestOptions.formData[key];
                } else {
                    requestOptions.formData[key] = value;
                }
            }

            //try to "replace" the channel first since that usually works.
            let response: HttpResponse;
            try {
                try {
                    console.log('calling once');
                    response = await this.doPostRequest(requestOptions);
                } catch (replaceError: any) {
                    //fail if this is a compile error
                    if (this.isCompileError(replaceError.message) && options.failOnCompileError) {
                        throw new errors.CompileError('Compile error', replaceError, replaceError.results);
                    } else if (this.isUpdateRequiredError(replaceError)) {
                        throw replaceError;
                    } else {
                        requestOptions.formData.mysubmit = 'Install';
                        response = await this.doPostRequest(requestOptions);
                    }
                }
            } catch (e: any) {
                //if this is a 577 error, we have high confidence that the device needs to do an update check
                if (this.isUpdateRequiredError(e)) {
                    throw new errors.UpdateCheckRequiredError(response, requestOptions, e);

                    //a reset connection could be cause by several things, but most likely it's due to the device needing to check for updates
                } else if (e.code === 'ECONNRESET') {
                    throw new errors.ConnectionResetError(e, requestOptions);
                } else {
                    throw e;
                }
            }

            //if we got a non-error status code, but the body includes a message about needing to update, throw a special error
            if (this.isUpdateCheckRequiredResponse(response.body)) {
                throw new errors.UpdateCheckRequiredError(response, requestOptions);
            }

            if (options.failOnCompileError) {
                if (this.isCompileError(response.body)) {
                    throw new errors.CompileError('Compile error', response, this.getRokuMessagesFromResponseBody(response.body));
                }
            }

            if (response.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                return { message: 'Identical to previous version -- not replacing', results: response };
            }
            logger.info('Successful sideload');
            return { message: 'Successful sideload', results: response };
        } finally {
            //delete the zip file only if configured to do so
            if (options.retainDeploymentArchive === false) {
                await fsExtra.remove(zipFilePath);
            }
            //try to close the read stream to prevent files becoming locked
            try {
                readStream?.close();
            } catch (e) {
                logger.warn('Error closing read stream', e);
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
     * Does the response look like a compile error
     */
    private isUpdateCheckRequiredResponse(responseHtml: string) {
        return !!/["']\s*Failed\s*to\s*check\s*for\s*software\s*update\s*["']/i.exec(responseHtml);
    }

    /**
     * Checks to see if the exception is due to the device needing to check for updates
     */
    private isUpdateRequiredError(e: any): boolean {
        return e.results?.response?.statusCode === 577 || (typeof e.results?.body === 'string' && this.isUpdateCheckRequiredResponse(e.results.body));
    }

    /**
     * Converts the currently sideloaded dev app to squashfs for faster loading packages
     * @param options
     */
    public async convertToSquashfs(options: ConvertToSquashfsOptions) {
        this.checkRequiredOptions(options, ['host', 'password']);
        options = this.getOptions(options) as any;
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options as any, {
            archive: '',
            mysubmit: 'Convert to squashfs'
        });
        let results;
        try {
            results = await this.doPostRequest(requestOptions);
        } catch (error) {
            //Occasionally this error is seen if the zip size and file name length at the
            //wrong combination. The device fails to respond to our request with a valid response.
            //The device successfully converted the zip, so ping the device and and check the response
            //for "fileType": "squashfs" then return a happy response, otherwise throw the original error
            if ((error as any).code === 'HPE_INVALID_CONSTANT') {
                try {
                    results = await this.doPostRequest(requestOptions, false);
                    if (/"fileType"\s*:\s*"squashfs"/.test(results.body)) {
                        return results;
                    }
                } catch (e) {
                    logger.warn('Error converting to squashfs:', error);
                    throw error;
                }
            } else {
                throw error;
            }
        }
        if (results.body.indexOf('Conversion succeeded') === -1) {
            throw new errors.ConvertError('Squashfs conversion failed');
        }
    }

    /**
     * resign Roku Device with supplied pkg and
     * @param options
     */
    public async rekeyDevice(options: RekeyDeviceOptions) {
        this.checkRequiredOptions(options, ['host', 'password', 'rekeySignedPackage', 'signingPassword']);
        options = this.getOptions(options) as any;

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
        logger.info('Creating signed package');
        this.checkRequiredOptions(options, ['host', 'password', 'signingPassword']);
        options = this.getOptions(options) as any;
        let manifestPath = path.join(options.stagingDir, 'manifest');
        let parsedManifest = await this.parseManifest(manifestPath);
        let appName = parsedManifest.title + '/' + parsedManifest.major_version + '.' + parsedManifest.minor_version;

        //prevent devId mismatch (if devId is specified)
        if (options.devId) {
            const deviceDevId = await this.getDevId(options);
            if (options.devId !== deviceDevId) {
                throw new Error(`Package signing cancelled: provided devId '${options.devId}' does not match on-device devId '${deviceDevId}'`);
            }
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

        //grab the package url from the JSON on the page if it exists (https://regex101.com/r/1HUXgk/1)
        let pkgSearchMatches = /"pkgPath"\s*:\s*"(.*?)"/.exec(results.body);
        if (pkgSearchMatches) {
            return pkgSearchMatches[1];
        }
        //for some reason we couldn't find the pkgPath from json, look in the <a> tag
        pkgSearchMatches = /<a href="(pkgs\/[^\.]+\.pkg)">/.exec(results.body);
        if (pkgSearchMatches) {
            const url = pkgSearchMatches[1];
            let requestOptions2 = this.generateBaseRequestOptions(url, options);

            let pkgFilePath = this.getOutputPkgFilePath(options as any);
            await this.downloadFile(requestOptions2, pkgFilePath);
            logger.info('Signed package created at:', pkgFilePath);
            return pkgFilePath;
        }

        throw new errors.UnknownDeviceResponseError('Unknown error signing package', results);
    }

    /**
     * Centralized function for handling POST http requests
     * @param params
     */
    private async doPostRequest(params: any, verify = true) {
        logger.info('handling POST request to', params.url);
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
        logger.info('handling GET request to', params.url);
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
            const host = results.response.request?.host?.toString?.();
            throw new errors.UnauthorizedDeviceResponseError(`Unauthorized. Please verify credentials for host '${host}'`, results);
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
        logger.info('Deleting dev channel...');
        this.checkRequiredOptions(options, ['host', 'password']);
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
    public async captureScreenshot(options: CaptureScreenshotOptions) {
        this.checkRequiredOptions(options, ['host', 'password']);
        options = this.getOptions(options);
        options.screenshotFile ??= `screenshot-${dayjs().format('YYYY-MM-DD-HH.mm.ss.SSS')}`;
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
            saveFilePath = util.standardizePath(path.join(options.screenshotDir, options.screenshotFile + imageExt));
            await this.downloadFile(
                this.generateBaseRequestOptions(imageUrlOnDevice, options),
                saveFilePath
            );
        } else {
            throw new Error('No screenshot url returned from device');
        }
        return saveFilePath;
    }

    private async downloadFile(requestParams: any, filePath: string) {
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
     * Get an options with all overridden values, and then defaults for missing values
     * @param options
     */
    public getOptions<T = RokuDeployOptions>(options: RokuDeployOptions & T = {} as any): RokuDeployOptions & T {
        // Fill in default options for any missing values
        options = {
            cwd: process.cwd(),
            outDir: './out',
            outFile: 'roku-deploy',
            retainDeploymentArchive: true,
            failOnCompileError: true,
            deleteDevChannel: true,
            packagePort: 80,
            remotePort: 8060,
            timeout: 150000,
            rootDir: './',
            files: [...DefaultFiles],
            username: 'rokudev',
            logLevel: 'error',
            screenshotDir: path.join(tempDir, '/roku-deploy/screenshots/'),
            ...options
        };
        options.cwd ??= process.cwd();
        logger.logLevel = options.logLevel;

        //fully resolve the folder paths
        options.rootDir = path.resolve(options.cwd, options.rootDir);
        options.outDir = path.resolve(options.cwd, options.outDir);
        options.screenshotDir = path.resolve(options.cwd, options.screenshotDir);

        //stagingDir
        if (options.stagingDir) {
            options.stagingDir = path.resolve(options.cwd, options.stagingDir);
        } else {
            options.stagingDir = path.resolve(
                options.cwd,
                util.standardizePath(`${options.outDir}/.roku-deploy-staging`)
            );
        }

        logger.info('Retrieved options:', options);
        return options;
    }

    public checkRequiredOptions<T extends Record<string, any>>(options: T, requiredOptions: Array<keyof T>) {
        for (let opt of requiredOptions as string[]) {
            if (options[opt] === undefined) {
                throw new Error('Missing required option: ' + opt);
            }
        }
    }

    /**
     * Centralizes getting output zip file path based on passed in options
     * @param options
     */
    private getOutputZipFilePath(options?: GetOutputZipFilePathOptions) {
        options = this.getOptions(options) as any;

        // If zipPath is provided, use it directly
        if (options.zipPath) {
            let zipFilePath = path.resolve(options.zipPath);
            // Ensure the path has a .zip extension if it doesn't already have .zip or .squashfs
            if (!zipFilePath.toLowerCase().endsWith('.zip') && !zipFilePath.toLowerCase().endsWith('.squashfs')) {
                zipFilePath += '.zip';
            }
            return zipFilePath;
        }

        // Fall back to original logic using outDir and outFile
        let zipFileName = options.outFile;
        if (!zipFileName.toLowerCase().endsWith('.zip') && !zipFileName.toLowerCase().endsWith('.squashfs')) {
            zipFileName += '.zip';
        }
        let outZipFilePath = path.resolve(options.cwd, options.outDir, zipFileName);
        logger.debug('Output zip file path:', outZipFilePath);
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
        logger.debug('Output pkg file path:', outPkgFilePath);
        return outPkgFilePath;
    }

    /**
     * Get the `device-info` response from a Roku device
     * @param host the host or IP address of the Roku
     * @param port the port to use for the ECP request (defaults to 8060)
     */
    public async getDeviceInfo(options?: GetDeviceInfoOptions & { enhance: true }): Promise<DeviceInfo>;
    public async getDeviceInfo(options?: GetDeviceInfoOptions): Promise<DeviceInfoRaw>;
    public async getDeviceInfo(options: GetDeviceInfoOptions) {
        this.checkRequiredOptions(options, ['host']);
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
            logger.debug('Device info:', deviceInfo);
            return deviceInfo;
        } catch (e) {
            logger.warn('Error getting device info:', e);
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
     * Get the developer ID from the device-info response
     * @param options
     * @returns
     */
    public async getDevId(options?: GetDevIdOptions) {
        this.checkRequiredOptions(options, ['host']);
        const deviceInfo = await this.getDeviceInfo(options);
        logger.debug('Found dev id:', deviceInfo['keyed-developer-id']);
        return deviceInfo['keyed-developer-id'];
    }

    private async parseManifest(manifestPath: string): Promise<ManifestData> {
        if (!await fsExtra.pathExists(manifestPath)) {
            throw new Error(manifestPath + ' does not exist');
        }

        let manifestContents = await fsExtra.readFile(manifestPath, 'utf-8');
        return this.parseManifestFromString(manifestContents);
    }

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
}

export interface ManifestData {
    [key: string]: any;
    keyIndexes?: Record<string, number>;
    lineCount?: number;
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
    'locale/**/*',
    'fonts/**/*',
    'manifest',
    '!node_modules',
    '!**/*.{md,DS_Store,db}'
];

export interface HttpResponse {
    response: any;
    body: any;
}

export interface CaptureScreenshotOptions {
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
    screenshotDir?: string;

    /**
     * The base filename the image file should be given (excluding the extension)
     * The default format looks something like this: screenshot-YYYY-MM-DD-HH.mm.ss.SSS.<jpg|png>
     */
    screenshotFile?: string;

    /**
     * The current working directory to use for relative paths
     */
    cwd?: string;
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

export type RokuKey = 'back' | 'backspace' | 'channeldown' | 'channelup' | 'down' | 'enter' | 'findremote' | 'fwd' | 'home' | 'info' | 'inputav1' | 'inputhdmi1' | 'inputhdmi2' | 'inputhdmi3' | 'inputhdmi4' | 'inputtuner' | 'instantreplay' | 'left' | 'play' | 'poweroff' | 'rev' | 'right' | 'search' | 'select' | 'up' | 'volumedown' | 'volumemute' | 'volumeup';

export interface SendKeyEventOptions {
    action?: 'keydown' | 'keypress' | 'keyup';
    host: string;
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    key: RokuKey | string;
    remotePort?: number;
    timeout?: number;
}

export interface KeyUpOptions extends SendKeyEventOptions {
    action?: 'keyup';
    key: RokuKey;
}

export interface KeyDownOptions extends SendKeyEventOptions {
    action?: 'keydown';
    key: RokuKey;
}

export interface KeyPressOptions extends SendKeyEventOptions {
    action?: 'keypress';
    key: RokuKey;
}

export interface SendTextOptions extends SendKeyEventOptions {
    action?: 'keypress';
    text: string;
}

export interface CloseChannelOptions {
    host: string;
    remotePort?: number;
    timeout?: number;

}
export interface StageOptions {
    rootDir?: string;
    files?: FileEntry[];
    stagingDir?: string;
    cwd?: string;
}

export interface ZipOptions {
    stagingDir?: string;
    outDir?: string;
    outFile?: string;
    cwd?: string;
}

export interface SideloadOptions {
    host: string;
    password: string;
    remoteDebug?: boolean;
    remoteDebugConnectEarly?: boolean;
    failOnCompileError?: boolean;
    retainDeploymentArchive?: boolean;
    outDir?: string;
    outFile?: string;
    deleteDevChannel?: boolean;
    cwd?: string;
    packageUploadOverrides?: PackageUploadOverridesOptions;
}

export interface PackageUploadOverridesOptions {
    route?: string;
    formData?: Record<string, any>;
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
    cwd?: string;
}

export interface CreateSignedPackageOptions {
    host: string;
    password: string;
    signingPassword: string;
    stagingDir?: string;
    outDir?: string;
    /**
     * If specified, signing will fail if the device's devId is different than this value
     */
    devId?: string;
    cwd?: string;
}

export interface DeleteDevChannelOptions {
    host: string;
    password: string;
}

export interface GetOutputZipFilePathOptions {
    outFile?: string;
    outDir?: string;
    cwd?: string;
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
    cwd?: string;
}

export interface GetOutputPkgFilePathOptions {
    outFile?: string;
    outDir?: string;
    cwd?: string;
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

//create a new static instance of RokuDeploy, and export those functions for backwards compatibility
export const rokuDeploy = new RokuDeploy();