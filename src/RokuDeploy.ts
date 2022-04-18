import * as path from 'path';
import * as _fsExtra from 'fs-extra';
import * as request from 'request';
import * as JSZip from 'jszip';
import * as dateformat from 'dateformat';
import * as errors from './Errors';
import * as isGlob from 'is-glob';
import * as picomatch from 'picomatch';
import * as xml2js from 'xml2js';
import type { ParseError } from 'jsonc-parser';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import { util } from './util';
import type { RokuDeployOptions, FileEntry } from './RokuDeployOptions';
import { Logger, LogLevel } from './Logger';
import * as tempDir from 'temp-dir';
import * as dayjs from 'dayjs';


export class RokuDeploy {

    constructor() {
        this.logger = new Logger();
    }

    private logger: Logger;
    //store the import on the class to make testing easier

    public fsExtra = _fsExtra;

    public screenshotDir = path.join(tempDir, '/roku-deploy/screenshots/');

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async prepublishToStaging(options: RokuDeployOptions) {
        options = this.getOptions(options);

        //clean the staging directory
        await this.fsExtra.remove(options.stagingFolderPath);

        //make sure the staging folder exists
        await this.fsExtra.ensureDir(options.stagingFolderPath);
        await this.copyToStaging(options.files, options.stagingFolderPath, options.rootDir);
        return options.stagingFolderPath;
    }

    /**
     * Given an array of `FilesType`, normalize them each into a `StandardizedFileEntry`.
     * Each entry in the array or inner `src` array will be extracted out into its own object.
     * This makes it easier to reason about later on in the process.
     * @param files
     */
    public normalizeFilesArray(files: FileEntry[]) {
        const result: Array<string | StandardizedFileEntry> = [];

        for (let i = 0; i < files.length; i++) {
            let entry = files[i];
            //skip falsey and blank entries
            if (!entry) {
                continue;

                //string entries
            } else if (typeof entry === 'string') {
                result.push(entry);

                //objects with src: (string | string[])
            } else if ('src' in entry) {
                //validate dest
                if (entry.dest !== undefined && entry.dest !== null && typeof entry.dest !== 'string') {
                    throw new Error(`Invalid type for "dest" at index ${i} of files array`);
                }

                //objects with src: string
                if (typeof entry.src === 'string') {
                    result.push({
                        src: util.standardizePath(entry.src),
                        dest: util.standardizePath(entry.dest)
                    });

                    //objects with src:string[]
                } else if ('src' in entry && Array.isArray(entry.src)) {
                    //create a distinct entry for each item in the src array
                    for (let srcEntry of entry.src) {
                        result.push({
                            src: util.standardizePath(srcEntry),
                            dest: util.standardizePath(entry.dest)
                        });
                    }
                } else {
                    throw new Error(`Invalid type for "src" at index ${i} of files array`);
                }
            } else {
                throw new Error(`Invalid entry at index ${i} in files array`);
            }
        }

        return result;
    }

    /**
     * Given an already-populated staging folder, create a zip archive of it and copy it to the output folder
     * @param options
     */
    public async zipPackage(options: RokuDeployOptions) {
        options = this.getOptions(options);

        //make sure the output folder exists
        await this.fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options);

        //ensure the manifest file exists in the staging folder
        if (!await util.fileExistsCaseInsensitive(`${options.stagingFolderPath}/manifest`)) {
            throw new Error(`Cannot zip package: missing manifest file in "${options.stagingFolderPath}"`);
        }

        //create a zip of the staging folder
        await this.zipFolder(options.stagingFolderPath, zipFilePath);

        //delete the staging folder unless told to retain it.
        if (options.retainStagingFolder !== true) {
            await this.fsExtra.remove(options.stagingFolderPath);
        }
    }

    /**
     * Create a zip folder containing all of the specified roku project files.
     * @param options
     */
    public async createPackage(options: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => Promise<void> | void) {
        options = this.getOptions(options);

        await this.prepublishToStaging(options);

        let manifestPath = util.standardizePath(`${options.stagingFolderPath}/manifest`);
        let parsedManifest = await this.parseManifest(manifestPath);

        if (options.incrementBuildNumber) {
            let timestamp = dateformat(new Date(), 'yymmddHHMM');
            parsedManifest.build_version = timestamp; //eslint-disable-line camelcase
            await this.fsExtra.writeFile(manifestPath, this.stringifyManifest(parsedManifest));
        }

        if (beforeZipCallback) {
            let info: BeforeZipCallbackInfo = {
                manifestData: parsedManifest,
                stagingFolderPath: options.stagingFolderPath
            };

            await Promise.resolve(beforeZipCallback(info));
        }
        await this.zipPackage(options);
    }

    /**
     * Given a root directory, normalize it to a full path.
     * Fall back to cwd if not specified
     * @param rootDir
     */
    public normalizeRootDir(rootDir: string) {
        if (!rootDir || (typeof rootDir === 'string' && rootDir.trim().length === 0)) {
            return process.cwd();
        } else {
            return path.resolve(rootDir);
        }
    }

    /**
    * Get all file paths for the specified options
    * @param files
    * @param stagingFolderPath - the absolute path to the staging folder
    * @param rootFolderPath - the absolute path to the root dir where relative files entries are relative to
    */
    public async getFilePaths(files: FileEntry[], rootDir: string): Promise<StandardizedFileEntry[]> {
        //if the rootDir isn't absolute, convert it to absolute using the standard options flow
        if (path.isAbsolute(rootDir) === false) {
            rootDir = this.getOptions({ rootDir: rootDir }).rootDir;
        }
        const entries = this.normalizeFilesArray(files);
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

                    const dest = this.computeFileDestPath(srcPath, entry, rootDir);
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

    /**
     * Given a full path to a file, determine its dest path
     * @param srcPath the absolute path to the file. This MUST be a file path, and it is not verified to exist on the filesystem
     * @param files the files array
     * @param rootDir the absolute path to the root dir
     * @param skipMatch - skip running the minimatch process (i.e. assume the file is a match
     * @returns the RELATIVE path to the dest location for the file.
     */
    public getDestPath(srcPathAbsolute: string, files: FileEntry[], rootDir: string, skipMatch = false) {
        srcPathAbsolute = util.standardizePath(srcPathAbsolute);
        rootDir = rootDir.replace(/\\+/g, '/');
        const entries = this.normalizeFilesArray(files);

        function makeGlobAbsolute(pattern: string) {
            return path.resolve(
                path.posix.join(
                    rootDir,
                    //remove leading exclamation point if pattern is negated
                    pattern
                    //coerce all slashes to forward
                )
            ).replace(/\\/g, '/');
        }

        let result: string;

        //add the file into every matching cache bucket
        for (let entry of entries) {
            const pattern = (typeof entry === 'string' ? entry : entry.src);
            //filter previous paths
            if (pattern.startsWith('!')) {
                const keepFile = picomatch('!' + makeGlobAbsolute(pattern.replace(/^!/, '')));
                if (!keepFile(srcPathAbsolute)) {
                    result = undefined;
                }
            } else {
                const keepFile = picomatch(makeGlobAbsolute(pattern));
                if (keepFile(srcPathAbsolute)) {
                    try {
                        result = this.computeFileDestPath(
                            srcPathAbsolute,
                            entry,
                            util.standardizePath(rootDir)
                        );
                    } catch {
                        //ignore errors...the file just has no dest path
                    }
                }
            }
        }
        return result;
    }

    /**
     * Compute the `dest` path. This accounts for magic globstars in the pattern,
     * as well as relative paths based on the dest. This is only used internally.
     * @param src an absolute, normalized path for a file
     * @param dest the `dest` entry for this file. If omitted, files will derive their paths relative to rootDir.
     * @param pattern the glob pattern originally used to find this file
     * @param rootDir absolute normalized path to the rootDir
     */
    private computeFileDestPath(srcPath: string, entry: string | StandardizedFileEntry, rootDir: string) {
        let result: string;
        let globstarIdx: number;
        //files under rootDir with no specified dest
        if (typeof entry === 'string') {
            if (util.isParentOfPath(rootDir, srcPath, false)) {
                //files that are actually relative to rootDir
                result = util.stringReplaceInsensitive(srcPath, rootDir, '');
            } else {
                // result = util.stringReplaceInsensitive(srcPath, rootDir, '');
                throw new Error('Cannot reference a file outside of rootDir when using a top-level string. Please use a src;des; object instead');
            }

            //non-glob-pattern explicit file reference
        } else if (!isGlob(entry.src.replace(/\\/g, '/'), { strict: false })) {
            let isEntrySrcAbsolute = path.isAbsolute(entry.src);
            let entrySrcPathAbsolute = isEntrySrcAbsolute ? entry.src : util.standardizePath(`${rootDir}/${entry.src}`);

            let isSrcChildOfRootDir = util.isParentOfPath(rootDir, entrySrcPathAbsolute, false);

            let fileNameAndExtension = path.basename(entrySrcPathAbsolute);

            //no dest
            if (entry.dest === null || entry.dest === undefined) {
                //no dest, absolute path or file outside of rootDir
                if (isEntrySrcAbsolute || isSrcChildOfRootDir === false) {
                    //copy file to root of staging folder
                    result = fileNameAndExtension;

                    //no dest, relative path, lives INSIDE rootDir
                } else {
                    //copy relative file structure to root of staging folder
                    let srcPathRelative = util.stringReplaceInsensitive(entrySrcPathAbsolute, rootDir, '');
                    result = srcPathRelative;
                }

                //assume entry.dest is the relative path to the folder AND file if applicable
            } else if (entry.dest === '') {
                result = fileNameAndExtension;
            } else {
                result = entry.dest;
            }
            //has a globstar
        } else if ((globstarIdx = entry.src.indexOf('**')) > -1) {
            const rootGlobstarPath = path.resolve(rootDir, entry.src.substring(0, globstarIdx)) + path.sep;
            const srcPathRelative = util.stringReplaceInsensitive(srcPath, rootGlobstarPath, '');
            if (entry.dest) {
                result = `${entry.dest}/${srcPathRelative}`;
            } else {
                result = srcPathRelative;
            }

            //`pattern` is some other glob magic
        } else {
            const fileNameAndExtension = path.basename(srcPath);
            result = util.standardizePath(`${entry.dest ?? ''}/${fileNameAndExtension}`);
        }

        result = util.standardizePath(
            //remove leading slashes
            result.replace(/^[\/\\]+/, '')
        );
        return result;
    }

    /**
     * Copy all of the files to the staging directory
     * @param fileGlobs
     * @param stagingPath
     */
    private async copyToStaging(files: FileEntry[], stagingPath: string, rootDir: string) {
        if (!stagingPath) {
            throw new Error('stagingPath is required');
        }
        if (!rootDir) {
            throw new Error('rootDir is required');
        }
        if (!await this.fsExtra.pathExists(rootDir)) {
            throw new Error(`rootDir does not exist at "${rootDir}"`);
        }

        let fileObjects = await this.getFilePaths(files, rootDir);
        //copy all of the files
        await Promise.all(fileObjects.map(async (fileObject) => {
            let destFilePath = util.standardizePath(`${stagingPath}/${fileObject.dest}`);

            //make sure the containing folder exists
            await this.fsExtra.ensureDir(path.dirname(destFilePath));

            //sometimes the copyfile action fails due to race conditions (normally to poorly constructed src;dest; objects with duplicate files in them
            await util.tryRepeatAsync(async () => {
                //copy the src item using the filesystem
                await this.fsExtra.copy(fileObject.src, destFilePath, {
                    //copy the actual files that symlinks point to, not the symlinks themselves
                    dereference: true
                });
            }, 10);
        }));
    }

    private generateBaseRequestOptions<T>(requestPath: string, options: RokuDeployOptions, formData = {} as T): request.OptionsWithUrl {
        options = this.getOptions(options);
        let url = `http://${options.host}:${options.packagePort}/${requestPath}`;
        let baseRequestOptions = {
            url: url,
            timeout: options.timeout,
            auth: {
                user: options.username,
                pass: options.password,
                sendImmediately: false
            },
            formData: formData
        };
        return baseRequestOptions;
    }

    /**
     * Simulate pressing the home button on the remote for this roku.
     * This makes the roku return to the home screen
     * @param host - the host
     * @param port - the port that should be used for the request. defaults to 8060
     * @param timeout - request timeout duration in milliseconds. defaults to 150000
     */
    public async pressHomeButton(host, port?: number, timeout?: number) {
        let options = this.getOptions();
        port = port ? port : options.remotePort;
        timeout = timeout ? timeout : options.timeout;
        // press the home button to return to the main screen
        return this.doPostRequest({
            url: `http://${host}:${port}/keypress/Home`,
            timeout: timeout
        }, false);
    }

    /**
     * Publish a pre-existing packaged zip file to a remote Roku.
     * @param options
     */
    public async publish(options: RokuDeployOptions): Promise<{ message: string; results: any }> {
        options = this.getOptions(options);
        if (!options.host) {
            throw new errors.MissingRequiredOptionError('must specify the host for the Roku device');
        }
        //make sure the outDir exists
        await this.fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options);
        let readStream: _fsExtra.ReadStream;
        try {
            if ((await this.fsExtra.pathExists(zipFilePath)) === false) {
                throw new Error(`Cannot publish because file does not exist at '${zipFilePath}'`);
            }
            readStream = this.fsExtra.createReadStream(zipFilePath);
            //wait for the stream to open (no harm in doing this, and it helps solve an issue in the tests)
            await new Promise((resolve) => {
                readStream.on('open', resolve);
            });

            let requestOptions = this.generateBaseRequestOptions('plugin_install', options, {
                mysubmit: 'Replace',
                archive: readStream
            });

            //attach the remotedebug flag if configured
            if (options.remoteDebug) {
                requestOptions.formData.remotedebug = '1';
            }

            //try to "replace" the channel first since that usually works.
            let response: HttpResponse;
            try {
                response = await this.doPostRequest(requestOptions);
            } catch (replaceError) {
                //"replace" failed, do an "install" instead
                requestOptions.formData.mysubmit = 'Install';
                response = await this.doPostRequest(requestOptions);
            }

            if (options.failOnCompileError) {
                if (response.body.indexOf('Install Failure: Compilation Failed.') > -1) {
                    throw new errors.CompileError('Compile error', response);
                }
            }

            if (response.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                return { message: 'Identical to previous version -- not replacing', results: response };
            }
            return { message: 'Successful deploy', results: response };
        } finally {
            //delete the zip file only if configured to do so
            if (options.retainDeploymentArchive === false) {
                await this.fsExtra.remove(zipFilePath);
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
     * Converts existing loaded package to squashfs for faster loading packages
     * @param options
     */
    public async convertToSquashfs(options: RokuDeployOptions) {
        options = this.getOptions(options);
        if (!options.host) {
            throw new errors.MissingRequiredOptionError('must specify the host for the Roku device');
        }
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options, {
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
    public async rekeyDevice(options: RokuDeployOptions) {
        options = this.getOptions(options);
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
        let requestOptions = this.generateBaseRequestOptions('plugin_inspect', options, {
            mysubmit: 'Rekey',
            passwd: options.signingPassword,
            archive: null as _fsExtra.ReadStream
        });

        let results: HttpResponse;
        try {
            requestOptions.formData.archive = this.fsExtra.createReadStream(rekeySignedPackagePath);
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
    public async signExistingPackage(options: RokuDeployOptions): Promise<string> {
        options = this.getOptions(options);
        if (!options.signingPassword) {
            throw new errors.MissingRequiredOptionError('Must supply signingPassword');
        }
        let manifestPath = path.join(options.stagingFolderPath, 'manifest');
        let parsedManifest = await this.parseManifest(manifestPath);
        let appName = parsedManifest.title + '/' + parsedManifest.major_version + '.' + parsedManifest.minor_version;

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

        let pkgSearchMatches = /<a href="(pkgs\/[^\.]+\.pkg)">/.exec(results.body);
        if (pkgSearchMatches) {
            return pkgSearchMatches[1];
        }

        throw new errors.UnknownDeviceResponseError('Unknown error signing package', results);
    }

    /**
     * Sign a pre-existing package using Roku and return path to retrieve it
     * @param pkgPath
     * @param options
     */
    public async retrieveSignedPackage(pkgPath: string, options: RokuDeployOptions): Promise<string> {
        options = this.getOptions(options);
        let requestOptions = this.generateBaseRequestOptions(pkgPath, options);

        let pkgFilePath = this.getOutputPkgFilePath(options);
        return this.getToFile(requestOptions, pkgFilePath);
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
    private async doGetRequest(params: any) {
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

        this.logger.debug(results.body);

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

    private getRokuMessagesFromResponseBody(body: string): { errors: Array<string>; infos: Array<string>; successes: Array<string> } {
        let errorMessages = [];
        let infos = [];
        let successes = [];
        let errorRegex = /Shell\.create\('Roku\.Message'\)\.trigger\('[\w\s]+',\s+'(\w+)'\)\.trigger\('[\w\s]+',\s+'(.*?)'\)/igm;
        let match;

        // eslint-disable-next-line no-cond-assign
        while (match = errorRegex.exec(body)) {
            let [, messageType, message] = match;
            switch (messageType.toLowerCase()) {
                case 'error':
                    errorMessages.push(message);
                    break;

                case 'info':
                    infos.push(message);
                    break;

                case 'success':
                    successes.push(message);
                    break;

                default:
                    break;
            }
        }

        return { errors: errorMessages, infos: infos, successes: successes };
    }

    /**
     * Create a zip of the project, and then publish to the target Roku device
     * @param options
     */
    public async deploy(options?: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => void) {
        options = this.getOptions(options);
        await this.createPackage(options, beforeZipCallback);
        if (options.deleteInstalledChannel) {
            try {
                await this.deleteInstalledChannel(options);
            } catch (e) {
                // note we don't report the error; as we don't actually care that we could not deploy - it's just useless noise to log it.
            }
        }
        let result = await this.publish(options);
        return result;
    }

    /**
     * Deletes any installed dev channel on the target Roku device
     * @param options
     */
    public async deleteInstalledChannel(options?: RokuDeployOptions) {
        options = this.getOptions(options);

        let deleteOptions = this.generateBaseRequestOptions('plugin_install', options);
        deleteOptions.formData = {
            mysubmit: 'Delete',
            archive: ''
        };
        return this.doPostRequest(deleteOptions);
    }

    /**
     * Gets a screenshot from the device. A side-loaded channel must be running or an error will be thrown.
     */
    public async takeScreenshot(options: { host: string; password: string; screenshotPath?: string }) {
        options.screenshotPath = options.screenshotPath ?? this.screenshotDir;

        let saveFilePath: string;
        const fileExtension = path.extname(options.screenshotPath);

        // Ask for the device to make an image
        let createScreenshotResult = await this.doPostRequest({
            ...this.generateBaseRequestOptions('plugin_inspect', options),
            formData: {
                mysubmit: 'Screenshot',
                archive: ''
            }
        });

        // Pull the image url out of the response body
        const [_, imageUrlOnDevice, imageExt] = /["'](pkgs\/dev(\.jpg|\.png)\?.+?)['"]/gi.exec(createScreenshotResult.body) ?? [];

        // is this assumed to be a dir?
        if (fileExtension === '') {
            saveFilePath = path.join(options.screenshotPath, `screenshot-${dayjs().format('YYYY-MM-DD-HH.mm.ss.SSS')}${imageExt}`);

        // Looks like this is a path with file name.
        // Does it match the type returned by the device?
        } else if (fileExtension === imageExt) {
            saveFilePath = options.screenshotPath;

            // everything else
        } else {
            throw new Error(`Can not, will not, convert image from ${imageExt} to ${fileExtension}`);
        }

        if (imageUrlOnDevice) {
            await this.getToFile(this.generateBaseRequestOptions(imageUrlOnDevice, options), saveFilePath);
        } else {
            throw new Error('No screen shot url returned from device');
        }
        return saveFilePath;
    }

    private async getToFile(requestParams: any, filePath: string) {
        await this.fsExtra.ensureDir(path.dirname(filePath));
        let writeStream: _fsExtra.WriteStream;
        return new Promise<string>((resolve, reject) => {
            writeStream = this.fsExtra.createWriteStream(filePath);
            request.get(requestParams).on('error', (err) => {
                try {
                    writeStream.close();
                } catch { }
                reject(err);
            }).on('response', (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error('Invalid response code: ' + response.statusCode));
                } else {
                    resolve(filePath);
                }
            }).pipe(writeStream);
        });
    }

    /**
     * executes sames steps as deploy and signs the package and stores it in the out folder
     * @param options
     */
    public async deployAndSignPackage(options?: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => void): Promise<string> {
        let originalOptionValueRetainStagingFolder = options.retainStagingFolder;
        options = this.getOptions(options);
        options.retainStagingFolder = true;
        await this.deploy(options, beforeZipCallback);

        if (options.convertToSquashfs) {
            await this.convertToSquashfs(options);
        }

        let remotePkgPath = await this.signExistingPackage(options);
        let localPkgFilePath = await this.retrieveSignedPackage(remotePkgPath, options);
        if (originalOptionValueRetainStagingFolder !== true) {
            await this.fsExtra.remove(options.stagingFolderPath);
        }
        return localPkgFilePath;
    }

    /**
     * Get an options with all overridden vaues, and then defaults for missing values
     * @param options
     */
    public getOptions(options: RokuDeployOptions = {}) {
        let fileOptions: RokuDeployOptions = {};
        const fileNames = ['rokudeploy.json', 'bsconfig.json'];
        if (options.project) {
            fileNames.unshift(options.project);
        }

        for (const fileName of fileNames) {
            if (this.fsExtra.existsSync(fileName)) {
                let configFileText = this.fsExtra.readFileSync(fileName).toString();
                let parseErrors = [] as ParseError[];
                fileOptions = parseJsonc(configFileText, parseErrors);
                if (parseErrors.length > 0) {
                    throw new Error(`Error parsing "${path.resolve(fileName)}": ` + JSON.stringify(
                        parseErrors.map(x => {
                            return {
                                message: printParseErrorCode(x.error),
                                offset: x.offset,
                                length: x.length
                            };
                        })
                    ));
                }
                break;
            }
        }

        let defaultOptions = <RokuDeployOptions>{
            outDir: './out',
            outFile: 'roku-deploy',
            retainStagingFolder: false,
            retainDeploymentArchive: true,
            incrementBuildNumber: false,
            failOnCompileError: true,
            deleteInstalledChannel: true,
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

        //stagingFolderPath
        if (finalOptions.stagingFolderPath) {
            finalOptions.stagingFolderPath = path.resolve(process.cwd(), finalOptions.stagingFolderPath);
        } else {
            finalOptions.stagingFolderPath = path.resolve(
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
    public getOutputZipFilePath(options: RokuDeployOptions) {
        options = this.getOptions(options);

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
    public getOutputPkgFilePath(options?: RokuDeployOptions) {
        options = this.getOptions(options);

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

    public async getDeviceInfo(options?: RokuDeployOptions) {
        options = this.getOptions(options);

        const requestOptions = {
            url: `http://${options.host}:${options.remotePort}/query/device-info`,
            timeout: options.timeout
        };
        let results = await this.doGetRequest(requestOptions);
        try {
            const parsedContent = await xml2js.parseStringPromise(results.body, {
                explicitArray: false
            });
            return parsedContent['device-info'];
        } catch (e) {
            throw new errors.UnparsableDeviceResponseError('Could not retrieve device info', results);
        }
    }

    public async getDevId(options?: RokuDeployOptions) {
        const deviceInfo = await this.getDeviceInfo(options);
        return deviceInfo['keyed-developer-id'];
    }

    public async parseManifest(manifestPath: string): Promise<ManifestData> {
        if (!await this.fsExtra.pathExists(manifestPath)) {
            throw new Error(manifestPath + ' does not exist');
        }

        let manifestContents = await this.fsExtra.readFile(manifestPath, 'utf-8');
        return this.parseManifestFromString(manifestContents);
    }

    public parseManifestFromString(manifestContents: string): ManifestData {
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

    /**
     * Given a path to a folder, zip up that folder and all of its contents
     * @param srcFolder
     * @param zipFilePath
     */
    public async zipFolder(srcFolder: string, zipFilePath: string, preFileZipCallback?: (file: StandardizedFileEntry, data: Buffer) => Buffer) {
        const files = await this.getFilePaths(['**/*'], srcFolder);

        const zip = new JSZip();
        // Allows us to wait until all are done before we build the zip
        const promises = [];
        for (const file of files) {
            const promise = this.fsExtra.readFile(file.src).then((data) => {
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
        return this.fsExtra.writeFile(zipFilePath, content);
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
    stagingFolderPath: string;
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
