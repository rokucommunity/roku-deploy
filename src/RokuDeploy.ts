import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { WriteStream, ReadStream } from 'fs-extra';
import * as r from 'postman-request';
import type * as requestType from 'request';
const request = r;
import * as JSZip from 'jszip';
import * as errors from './Errors';
import * as xml2js from 'xml2js';
import { parse as parseJsonc } from 'jsonc-parser';
import { util } from './util';
import type { FileEntry } from './RokuDeployOptions';
import { logger, type LogLevel } from '@rokucommunity/logger';
import * as dayjs from 'dayjs';
import * as lodash from 'lodash';
import type { DeviceInfo, DeviceInfoRaw } from './DeviceInfo';
import * as tempDir from 'temp-dir';
import * as semver from 'semver';

export class RokuDeploy {
    /**
     * Default values for common options used across multiple functions
     */
    private static readonly defaults = {
        timeout: 150000,
        packagePort: 80,
        ecpPort: 8060,
        outDir: './out',
        outFile: 'roku-deploy.zip'
    };

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async stage(options: StageOptions) {
        logger.info('Beginning to copy files to staging folder');
        const cwd = options.cwd ?? process.cwd();

        // Set defaults and resolve paths
        const rootDir = path.resolve(cwd, options.rootDir ?? './');
        const files = options.files ?? [...DefaultFiles];

        // Resolve output directory - use 'out' if provided, otherwise default to staging dir
        const out = options.out
            ? path.resolve(cwd, options.out)
            : path.resolve(cwd, RokuDeploy.defaults.outDir, '.roku-deploy-staging');

        //clean the staging directory
        await fsExtra.remove(out);

        //make sure the staging folder exists
        await fsExtra.ensureDir(out);

        if (!await fsExtra.pathExists(rootDir)) {
            throw new Error(`rootDir does not exist at "${rootDir}"`);
        }

        let fileObjects = await this.getFilePaths({ files: files, rootDir: rootDir });
        //copy all of the files
        await Promise.all(fileObjects.map(async (fileObject) => {
            let destFilePath = util.standardizePath(`${out}/${fileObject.dest}`);

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
        logger.info('Relevant files copied to:', out);
        return out;
    }

    /**
     * Given an already-populated staging folder, create a zip archive of it and copy it to the output folder
     * @param options
     */
    public async zip(options: ZipOptions): Promise<string> {
        logger.info('Beginning to zip');
        const cwd = options.cwd ?? process.cwd();

        // dir is required
        if (!options.dir) {
            throw new Error('"dir" is required for zip');
        }

        const dir = path.resolve(cwd, options.dir);

        // Resolve output zip path - use 'out' if provided, otherwise default
        let out = options.out
            ? path.resolve(cwd, options.out)
            : path.resolve(cwd, RokuDeploy.defaults.outDir, RokuDeploy.defaults.outFile);

        // Ensure .zip extension
        if (!out.toLowerCase().endsWith('.zip')) {
            out += '.zip';
        }

        // Get files to include - use provided files array or default to everything
        const files = options.files ?? ['**/*'];

        // Check that manifest will be included
        const filePaths = await this.getFilePaths({ files: files, rootDir: dir });
        const hasManifest = filePaths.some(f => f.dest.toLowerCase() === 'manifest');
        if (!hasManifest) {
            throw new Error(`Cannot zip package: missing manifest file in "${dir}"`);
        }
        await this.makeZip(dir, out, files);
        logger.info('Zip created at:', out);
        return out;
    }

    /**
     * Given a path to a folder, zip up that folder and all of its contents
     * @param srcFolder the folder that should be zipped
     * @param zipFilePath the path to the zip that will be created
     * @param files a files array used to filter the files from `srcFolder`
     */
    private async makeZip(srcFolder: string, zipFilePath: string, files: FileEntry[] = ['**/*']) {
        const filePaths = await this.getFilePaths({ files: files, rootDir: srcFolder });

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
                zip.file(file.dest.replace(/[\\/]/g, '/'), data as Uint8Array, {
                    compression: compression
                });
            });
            promises.push(promise);
        }
        await Promise.all(promises);

        //ensure the output directory exists
        await fsExtra.ensureDir(
            path.dirname(zipFilePath)
        );
        // level 2 compression seems to be the best balance between speed and file size. Speed matters more since most will be calling squashfs afterwards.
        const content = await zip.generateAsync({ type: 'nodebuffer', compressionOptions: { level: 2 } });
        return fsExtra.writeFile(zipFilePath, content);
    }

    /**
    * Get all file paths for the specified options
    */
    public async getFilePaths(options: GetFilePathsOptions): Promise<StandardizedFileEntry[]> {
        let rootDir = options.rootDir;
        const files = options.files;

        //if the rootDir isn't absolute, convert it to absolute
        if (path.isAbsolute(rootDir) === false) {
            rootDir = path.resolve(process.cwd(), rootDir);
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
        // Set defaults for request options
        const packagePort = options.packagePort ?? RokuDeploy.defaults.packagePort;
        const timeout = options.timeout ?? RokuDeploy.defaults.timeout;
        const username = options.username ?? 'rokudev';

        let url = `http://${options.host}:${packagePort}/${requestPath}`;
        let baseRequestOptions = {
            url: url,
            timeout: timeout,
            auth: {
                user: username,
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
        this.checkRequiredOptions(options, ['host', 'text']);
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
        // Set defaults
        const ecpPort = options.ecpPort ?? RokuDeploy.defaults.ecpPort;
        const timeout = options.timeout ?? RokuDeploy.defaults.timeout;
        // press the home button to return to the main screen
        return this.doPostRequest({
            url: `http://${options.host}:${ecpPort}/${options.action}/${options.key}`,
            timeout: timeout
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
     * Sideload a zip to a remote Roku. Either `zip` (path to a pre-built zip) or `dir` (directory
     * to zip on-the-fly) must be provided.
     * @param options
     */
    public async sideload(options: SideloadOptions): Promise<{ message: string; results: any }> {
        logger.info('Beginning to sideload package');
        this.checkRequiredOptions(options, ['host', 'password']);

        const cwd = options.cwd ?? process.cwd();
        // Set defaults
        const deleteDevChannel = options.deleteDevChannel ?? true;
        const failOnCompileError = options.failOnCompileError ?? true;

        let zipFilePath: string;
        let deleteZipAfterSideload = false;

        // Close the channel before sideloading unless explicitly disabled
        if (options.close !== false) {
            await this.closeChannel(options as CloseChannelOptions);
        }

        // Determine the zip file path based on whether zip or dir was provided
        if ('zip' in options && options.zip) {
            zipFilePath = path.resolve(cwd, options.zip);
        } else if ('dir' in options && options.dir) {
            // Generate zip from directory to a temp location
            zipFilePath = path.resolve(cwd, RokuDeploy.defaults.outDir, RokuDeploy.defaults.outFile);
            await this.zip({ dir: path.resolve(cwd, options.dir), out: zipFilePath, cwd: cwd });
            deleteZipAfterSideload = true;
        } else {
            throw new Error('Either zip or dir must be provided');
        }

        if (deleteDevChannel) {
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
                archive: readStream,
                ...(options.appType ? { 'app_type': options.appType } : {})
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
                    response = await this.doPostRequest(requestOptions);
                } catch (replaceError: any) {
                    //fail if this is a compile error
                    if (this.isCompileError(replaceError.message) && failOnCompileError) {
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

            if (failOnCompileError) {
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
            //delete the zip file if we generated it from rootDir
            if (deleteZipAfterSideload) {
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
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options, {
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
     * resign Roku Device with a supplied signed pkg and
     * @param options
     */
    public async rekeyDevice(options: RekeyDeviceOptions) {
        this.checkRequiredOptions(options, ['host', 'password', 'pkg', 'signingPassword']);
        const cwd = path.resolve(process.cwd(), options.cwd ?? '.');

        let pkgPath = options.pkg;
        if (!path.isAbsolute(options.pkg)) {
            pkgPath = path.resolve(cwd, options.pkg);
        }
        let requestOptions = this.generateBaseRequestOptions('plugin_inspect', options as any, {
            mysubmit: 'Rekey',
            passwd: options.signingPassword,
            archive: null as ReadStream
        });

        let results: HttpResponse;
        try {
            requestOptions.formData.archive = fsExtra.createReadStream(pkgPath);
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
     * Sign a pre-existing package using Roku and return path to it locally
     * @param options
     */
    public async createSignedPackage(options: CreateSignedPackageOptions): Promise<string> {
        logger.info('Creating signed package');
        this.checkRequiredOptions(options, ['host', 'password', 'signingPassword']);
        const cwd = options.cwd ?? process.cwd();

        // Resolve output pkg path - use 'out' if provided, otherwise derive from default
        let out = options.out
            ? path.resolve(cwd, options.out)
            : path.resolve(cwd, RokuDeploy.defaults.outDir, 'roku-deploy.pkg');

        // Ensure .pkg extension
        if (out.toLowerCase().endsWith('.zip')) {
            out = out.replace(/\.zip$/i, '.pkg');
        } else if (!out.toLowerCase().endsWith('.pkg')) {
            out += '.pkg';
        }

        // Process options for app title and app version
        if (options.appTitle || options.appVersion) {
            if (!options.appTitle || !options.appVersion) {
                throw new Error('Either appTitle and appVersion is missing; both must be provided, or a manifestPath can be provided instead.');
            }
        } else if (options.manifestPath) {
            let manifestPath = path.resolve(cwd, options.manifestPath);
            let parsedManifest = await this.parseManifest(manifestPath);
            if (parsedManifest.major_version === undefined || parsedManifest.minor_version === undefined) {
                throw new Error('Either major or minor version is missing from the manifest');
            }
            options.appVersion = parsedManifest.major_version + '.' + parsedManifest.minor_version;
            options.appTitle = parsedManifest.title;
            if (!options.appTitle) {
                throw new Error('Value for appTitle is missing from the manifest');
            }
        } else {
            throw new Error('Either appTitle and appVersion or manifestPath must be provided');
        }

        let appName = options.appTitle + '/' + options.appVersion;

        //prevent devId mismatch (if devId is specified)
        if (options.devId) {
            const deviceDevId = await this.getDevId(options);
            if (options.devId !== deviceDevId) {
                throw new Error(`Package signing cancelled: provided devId '${options.devId}' does not match on-device devId '${deviceDevId}'`);
            }
        }

        let requestOptions = this.generateBaseRequestOptions('plugin_package', options, {
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
        if (!pkgSearchMatches) {
            //for some reason we couldn't find the pkgPath from json, look in the <a> tag
            pkgSearchMatches = /<a href="(pkgs\/[^\.]+\.pkg)">/.exec(results.body);
        }
        if (pkgSearchMatches) {
            const url = pkgSearchMatches[1];
            let requestOptions2 = this.generateBaseRequestOptions(url, options);
            await this.downloadFile(requestOptions2, out);
            logger.info('Signed package created at:', out);
            return out;
        }

        throw new errors.UnknownDeviceResponseError('Unknown error signing package', results);
    }

    /**
     * Set the `User-Agent` header if missing from the request params, ensuring it's included in all requests made by roku-deploy
     * @param params
     * @returns
     */
    private setUserAgentIfMissing(params: requestType.OptionsWithUrl) {
        if (!params) {
            params = {} as requestType.OptionsWithUrl;
        }
        if (!params.headers) {
            params.headers = {};
        }
        if (!params.headers['User-Agent']) {
            params.headers['User-Agent'] = this.getUserAgent();
        }
        return params;
    }

    /**
     * Get the user-agent string used for HTTP requests sent by this package
     * @returns
     */
    private getUserAgent() {
        try {
            if (this._packageVersion === undefined) {
                this._packageVersion = fsExtra.readJsonSync(`${__dirname}/../package.json`).version;
            }
        } catch (e) {
            this._packageVersion = null;
        }
        return `roku-deploy/${this._packageVersion ?? 'unknown'}`;
    }

    private _packageVersion: string;

    /**
     * Centralized function for handling POST http requests
     * @param params
     */
    private async doPostRequest(params: requestType.OptionsWithUrl, verify = true) {
        logger.info('handling POST request to', params.url);
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {

            this.setUserAgentIfMissing(params);

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

            this.setUserAgentIfMissing(params);

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
     * Parse out the list of packages that are currently installed on the device by looking for the JSON in the response body
     * @param body
     * @returns
     */
    private getPackagesFromResponseBody(body: string): RokuPackage[] {
        let jsonParseRegex = /JSON\.parse\(('.+')\);/igm;
        let jsonMatch: RegExpExecArray;

        while ((jsonMatch = jsonParseRegex.exec(body))) {
            let [, jsonString] = jsonMatch;
            let jsonObject = parseJsonc(jsonString);
            if (typeof jsonObject === 'object' && !Array.isArray(jsonObject) && jsonObject !== null) {
                let packages = jsonObject.packages;

                if (!Array.isArray(packages)) {
                    continue;
                }
                return packages;
            }
        }
        return [];
    }

    /**
     * Deletes any installed dev channel on the target Roku device
     * @param options
     */
    public async deleteDevChannel(options?: DeleteDevChannelOptions) {
        logger.info('Deleting dev channel...');
        this.checkRequiredOptions(options, ['host', 'password']);

        let deleteOptions = this.generateBaseRequestOptions('plugin_install', options);
        deleteOptions.formData = {
            mysubmit: 'Delete',
            archive: ''
        };
        return this.doPostRequest(deleteOptions);
    }

    /**
     * Delete the component library with the specified filename from the device
     */
    public async deleteComponentLibrary(options?: { host: string; password: string; fileName: string; username?: string }) {
        this.checkRequiredOptions(options, ['host', 'password', 'fileName']);

        let deleteOptions = this.generateBaseRequestOptions('plugin_install', options);
        deleteOptions.formData = {
            mysubmit: 'Delete',
            'app_type': 'dcl',
            fileName: options.fileName
        };
        deleteOptions.qs ??= {};
        // eslint-disable-next-line camelcase
        deleteOptions.qs.dcl_enabled = '1';
        await this.doPostRequest(deleteOptions);
    }

    /**
     * Delete all component libraries from the device
     */
    public async deleteAllComponentLibraries(options: { host: string; password: string; username?: string }) {
        const packages = await this.getInstalledPackages(options);
        for (const pkg of packages) {
            if (pkg.appType === 'dcl') {
                await this.deleteComponentLibrary({
                    ...options,
                    fileName: pkg.archiveFileName
                });
            }
        }
    }

    /**
     * Fetch the full list of installed packages from the device. Useful for finding the file names of installed component libraries or the dev channel.
     */
    private async getInstalledPackages(options: { host: string; password: string; username?: string }): Promise<RokuPackage[]> {
        this.checkRequiredOptions(options, ['host', 'password']);
        let deleteOptions = this.generateBaseRequestOptions('plugin_install', options);
        deleteOptions.qs ??= {};
        // eslint-disable-next-line camelcase
        deleteOptions.qs.dcl_enabled = '1';
        const result = await this.doGetRequest(deleteOptions);
        const packages = this.getPackagesFromResponseBody(result.body);
        return packages;
    }

    /**
     * Gets a screenshot from the device. A side-loaded channel must be running or an error will be thrown.
     * Always returns an object with the screenshot buffer. If `out` is provided, also saves to disk.
     */
    public async captureScreenshot(options: CaptureScreenshotOptions): Promise<CaptureScreenshotResult> {
        this.checkRequiredOptions(options, ['host', 'password']);

        // Ask for the device to make an image
        let createScreenshotResult = await this.doPostRequest({
            ...this.generateBaseRequestOptions('plugin_inspect', options),
            formData: {
                mysubmit: 'Screenshot',
                archive: ''
            }
        });

        // Pull the image url out of the response body
        const [_, imageUrlOnDevice, deviceExt] = /["'](pkgs\/dev(\.jpg|\.png)\?.+?)['"]/gi.exec(createScreenshotResult.body) ?? [];

        if (!imageUrlOnDevice) {
            throw new Error('No screenshot url returned from device');
        }

        const requestParams = this.generateBaseRequestOptions(imageUrlOnDevice, options);

        // Always download to buffer
        const buffer = await this.downloadToBuffer(requestParams);

        const result: CaptureScreenshotResult = { buffer };

        // If out is provided, also save to disk
        if (options.out) {
            const cwd = options.cwd ?? process.cwd();
            const screenshotDir = options.screenshotDir
                ? path.resolve(cwd, options.screenshotDir)
                : path.join(tempDir, '/roku-deploy/screenshots/');

            let filePath: string;
            if (options.out === true) {
                // Use default directory with generated filename
                const defaultFilename = `screenshot-${dayjs().format('YYYY-MM-DD-HH.mm.ss.SSS')}${deviceExt}`;
                filePath = path.resolve(cwd, screenshotDir, defaultFilename);
            } else {
                // User provided a path
                filePath = path.resolve(cwd, options.out);
                const userExt = path.extname(filePath).toLowerCase();
                const deviceExtLower = deviceExt.toLowerCase();

                if (options.autoExtension) {
                    if (userExt === deviceExtLower) {
                        // User extension matches device extension - use as-is
                    } else if (userExt === '.jpg' || userExt === '.jpeg' || userExt === '.png') {
                        // User provided an image extension that doesn't match - swap it
                        filePath = filePath.slice(0, -userExt.length) + deviceExt;
                    } else {
                        // No recognized image extension - append device extension
                        filePath += deviceExt;
                    }
                }
            }

            await fsExtra.ensureFile(filePath);
            await fsExtra.writeFile(filePath, buffer);
            result.filePath = filePath;
        }

        return result;
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

    private downloadToBuffer(requestParams: any): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            request.get(requestParams)
                .on('error', (err) => {
                    reject(err);
                })
                .on('response', (response) => {
                    if (response.statusCode !== 200) {
                        return reject(new Error('Invalid response code: ' + response.statusCode));
                    }
                })
                .on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                })
                .on('end', () => {
                    resolve(Buffer.concat(chunks));
                });
        });
    }

    public checkRequiredOptions<T extends Record<string, any>>(options: T, requiredOptions: Array<keyof T>) {
        for (let opt of requiredOptions as string[]) {
            if (options[opt] === undefined) {
                throw new Error('Missing required option: ' + opt);
            }
        }
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

        // Set defaults
        const ecpPort = options.ecpPort ?? RokuDeploy.defaults.ecpPort;
        const timeout = options.timeout ?? RokuDeploy.defaults.timeout;

        //if the host is a DNS name, look up the IP address
        let host = options.host;
        try {
            host = await util.dnsLookup(options.host);
        } catch (e) {
            //try using the host as-is (it'll probably fail...)
        }

        const url = `http://${host}:${ecpPort}/query/device-info`;

        let response;
        try {
            response = await this.doGetRequest({
                url: url,
                timeout: timeout
            });
        } catch (e) {
            if ((e as any)?.results?.response?.headers?.server?.includes('Roku')) {
                throw new errors.EcpNetworkAccessModeDisabledError(`Unable to access device-info because ecp-setting-mode is 'disabled'`, response);
            }
            throw e;
        }
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
     * Get the External Control Protocol (ECP) setting mode of the device. This determines whether
     * the device accepts remote control commands via the ECP API.
     *
     * @param options - Configuration options including host, ecpPort, timeout, etc.
     * @returns The ECP setting mode:
     *   - 'enabled': fully enabled and accepting commands
     *   - 'disabled': ECP is disabled (device may still be reachable but ECP commands won't work)
     *   - 'limited': Restricted functionality, text and movement commands only
     *   - 'permissive': Full access for internal networks
     */
    public async getEcpNetworkAccessMode(options: GetDeviceInfoOptions): Promise<EcpNetworkAccessMode> {
        try {
            const deviceInfo = await this.getDeviceInfo(options);
            return deviceInfo['ecp-setting-mode'];
        } catch (e) {
            if ((e as any)?.results?.response?.headers?.server?.includes('Roku')) {
                return 'disabled';
            }
            throw new errors.UnknownDeviceResponseError('Could not retrieve device ECP setting');
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

    public async rebootDevice(options: RebootDeviceOptions) {
        this.checkRequiredOptions(options, ['host', 'password']);

        // Get device info to check software version
        const deviceInfo = await this.getDeviceInfo(options);
        const softwareVersion = deviceInfo['software-version'];

        // Check if device version is at least 15.0.4
        if (!softwareVersion || semver.lt(semver.coerce(softwareVersion), '15.0.4')) {
            throw new errors.UnsupportedFirmwareVersionError(`Device software version ${softwareVersion} is below the minimum required version 15.0.4 for reboot operation`);
        }

        return this.doPostRequest({
            ...this.generateBaseRequestOptions('plugin_swup', options),
            formData: {
                mysubmit: 'Reboot',
                archive: ''
            }
        });
    }

    public async checkForUpdate(options: CheckForUpdateOptions) {
        this.checkRequiredOptions(options, ['host', 'password']);

        // Get device info to check software version
        const deviceInfo = await this.getDeviceInfo(options);
        const softwareVersion = deviceInfo['software-version'];

        // Check if device version is at least 15.0.4
        if (!softwareVersion || semver.lt(semver.coerce(softwareVersion), '15.0.4')) {
            throw new errors.UnsupportedFirmwareVersionError(`Device software version ${softwareVersion} is below the minimum required version 15.0.4 for check update operation`);
        }

        return this.doPostRequest({
            ...this.generateBaseRequestOptions('plugin_swup', options),
            formData: {
                mysubmit: 'CheckUpdate',
                archive: ''
            }
        });
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

export interface RokuPackage {
    appType: 'channel' | 'dcl';
    archiveFileName: string;
    fileType: string;
    id: number;
    location: string;
    md5: string;
    pkgPath: string;
    size: string;
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

export interface CaptureScreenshotOptions extends BaseRequestOptions {
    /**
     * When provided, saves the screenshot to disk in addition to returning the buffer.
     * - If `true`, saves to the default location (screenshotDir or OS temp directory)
     * - If a string path, saves to that location
     */
    out?: string | true;

    /**
     * The current working directory to use for relative paths
     */
    cwd?: string;

    /**
     * The directory where screenshots should be saved when `out` is `true`.
     * Defaults to the OS temp directory.
     */
    screenshotDir?: string;

    /**
     * When false (default), the filename is used exactly as provided by the user.
     * When true, the extension is automatically handled:
     *   - If the user's filename ends with the device's extension, use it as-is
     *   - If the user's filename ends with .png or .jpg but doesn't match the device's format, swap the extension
     *   - Otherwise, append the device's extension to the filename
     * @default false
     */
    autoExtension?: boolean;
}

export interface CaptureScreenshotResult {
    /**
     * The screenshot image data
     */
    buffer: Buffer;
    /**
     * The file path where the screenshot was saved (only present when `out` option was provided)
     */
    filePath?: string;
}

export interface GetDeviceInfoOptions extends BaseEcpOptions {
    /**
     * Should the device-info be enhanced by camel-casing the property names and converting boolean strings to booleans and number strings to numbers?
     * @default false
     */
    enhance?: boolean;
}

export type RokuKey = 'back' | 'backspace' | 'channeldown' | 'channelup' | 'down' | 'enter' | 'findremote' | 'fwd' | 'home' | 'info' | 'inputav1' | 'inputhdmi1' | 'inputhdmi2' | 'inputhdmi3' | 'inputhdmi4' | 'inputtuner' | 'instantreplay' | 'left' | 'play' | 'poweroff' | 'rev' | 'right' | 'search' | 'select' | 'up' | 'volumedown' | 'volumemute' | 'volumeup';

export interface SendKeyEventOptions extends BaseEcpOptions {
    action?: 'keydown' | 'keypress' | 'keyup';
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    key: RokuKey | string;
}

export interface KeyUpOptions extends BaseEcpOptions {
    key: RokuKey;
}

export interface KeyDownOptions extends BaseEcpOptions {
    key: RokuKey;
}

export interface KeyPressOptions extends BaseEcpOptions {
    key: RokuKey;
}

export interface SendTextOptions extends BaseEcpOptions {
    text: string;
}

export type CloseChannelOptions = BaseEcpOptions;

export interface GetFilePathsOptions {
    files: FileEntry[];
    rootDir: string;
}

export interface StageOptions {
    rootDir?: string;
    files?: FileEntry[];
    /**
     * The output directory where staged files will be placed
     */
    out?: string;
    cwd?: string;
}

export interface ZipOptions {
    /**
     * The directory containing the files to be zipped
     */
    dir: string;
    /**
     * An optional array of file patterns to include in the zip.
     * If not provided, defaults to all files (`**\/*`).
     */
    files?: FileEntry[];
    /**
     * The output zip file path (e.g., './out/roku-deploy.zip')
     */
    out?: string;
    cwd?: string;
}

type BaseSideloadOptions = BaseRequestOptions & BaseEcpOptions & {
    appType?: 'channel' | 'dcl';
    close?: boolean;
    remoteDebug?: boolean;
    remoteDebugConnectEarly?: boolean;
    failOnCompileError?: boolean;
    deleteDevChannel?: boolean;
    cwd?: string;
    packageUploadOverrides?: PackageUploadOverridesOptions;
};

export type SideloadOptions = BaseSideloadOptions & (
    | { zip: string; dir?: never }
    | { dir: string; zip?: never }
);

export interface PackageUploadOverridesOptions {
    route?: string;
    formData?: Record<string, any>;
}

export interface BaseRequestOptions {
    host: string;
    username?: string;
    password: string;
    packagePort?: number;
    timeout?: number;
    logLevel?: LogLevel;
}

export interface BaseEcpOptions {
    host: string;
    ecpPort?: number;
    timeout?: number;
}

export type ConvertToSquashfsOptions = BaseRequestOptions;

export interface RekeyDeviceOptions extends BaseRequestOptions {
    pkg: string;
    signingPassword: string;
    devId: string;
    cwd?: string;
}

export interface CreateSignedPackageOptions extends BaseRequestOptions {
    signingPassword: string;
    appTitle?: string;
    appVersion?: string;
    manifestPath?: string;
    /**
     * The output pkg file path (e.g., './out/roku-deploy.pkg')
     */
    out?: string;
    /**
     * If specified, signing will fail if the device's devId is different than this value
     */
    devId?: string;
    cwd?: string;
}

export type DeleteDevChannelOptions = BaseRequestOptions;

export type RebootDeviceOptions = BaseRequestOptions;

export type CheckForUpdateOptions = BaseRequestOptions;

export interface GetOutputZipFilePathOptions {
    out?: string;
    cwd?: string;
}

export interface DeployOptions extends BaseRequestOptions {
    files?: FileEntry[];
    rootDir?: string;
    stagingDir?: string;
    deleteDevChannel?: boolean;
    out?: string;
    cwd?: string;
}

export type GetDevIdOptions = BaseEcpOptions;

//create a new static instance of RokuDeploy, and export those functions for backwards compatibility
export const rokuDeploy = new RokuDeploy();
export type EcpNetworkAccessMode = 'enabled' | 'disabled' | 'limited' | 'permissive';
