import * as path from 'path';
import * as _fsExtra from 'fs-extra';
import * as request from 'request';
import * as JSZip from 'jszip';
import * as dateformat from 'dateformat';
import * as errors from './Errors';
import * as minimatch from 'minimatch';
import * as glob from 'glob';
import * as xml2js from 'xml2js';
import { promisify } from 'util';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
const globAsync = promisify(glob);

import { util } from './util';
import { RokuDeployOptions, FileEntry } from './RokuDeployOptions';
import { Logger, LogLevel } from './Logger';

export class RokuDeploy {

    constructor() {
        this.logger = new Logger();
    }

    private logger: Logger;
    //store the import on the class to make testing easier
    public request = request;
    public fsExtra = _fsExtra;

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async prepublishToStaging(options: RokuDeployOptions) {
        options = this.getOptions(options);

        const files = this.normalizeFilesArray(options.files);

        //clean the staging directory
        await this.fsExtra.remove(options.stagingFolderPath);

        //make sure the staging folder exists
        await this.fsExtra.ensureDir(options.stagingFolderPath);
        await this.copyToStaging(files, options.stagingFolderPath, options.rootDir);
        return options.stagingFolderPath;
    }

    /**
     * Given an array of `FilesType`, normalize each of them into a standard {src;dest} object.
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
    public async getFilePaths(files: FileEntry[], rootDir: string) {
        //if the rootDir isn't absolute, convert it to absolute using the standard options flow
        if (path.isAbsolute(rootDir) === false) {
            rootDir = this.getOptions({ rootDir: rootDir }).rootDir;
        }
        const normalizedFiles = this.normalizeFilesArray(files);

        let result = [] as StandardizedFileEntry[];

        for (let entry of normalizedFiles) {
            let src = typeof entry === 'string' ? entry : entry.src;

            //if starts with !, this is a negated glob.
            let isNegated = src.startsWith('!');

            //remove the ! so the glob will match properly
            if (isNegated) {
                src = src.substring(1);
            }

            let entryResults = await this.getFilePathsForEntry(
                typeof entry === 'string' ? src : { ...entry, src: src },
                rootDir
            );

            //if negated, remove all of the negated matches from the results
            if (isNegated) {
                let paths = entryResults.map(x => x.src);
                result = result.filter(x => !paths.includes(x.src));

                //add all of the entries to the results
            } else {
                result.push(...entryResults);
            }
        }

        //only keep the last entry of each `dest` path
        let destPaths = {} as { [key: string]: boolean };
        for (let i = result.length - 1; i >= 0; i--) {
            let entry = result[i];

            //if we have already seen this dest path, this is a duplicate...throw it out
            if (destPaths[entry.dest]) {
                result.splice(i, 1);
            } else {
                //this is the first time we've seen this entry, keep it and move on
                destPaths[entry.dest] = true;
            }
        }

        return result;
    }

    private async getFilePathsForEntry(entry: StandardizedFileEntry | string, rootDir: string) {
        //container for the files for this entry
        let result = [] as StandardizedFileEntry[];

        let pattern = typeof entry === 'string' ? entry : entry.src;
        let files = await globAsync(pattern, {
            cwd: rootDir,
            absolute: true,
            follow: true
        });

        //reduce garbage collection churn by using the same filesEntry array for each file below
        let fileEntries = [entry];

        for (let filePathAbsolute of files) {
            //only include files (i.e. skip directories)
            if (await util.isFile(filePathAbsolute)) {
                //throw an exception when a top-level string references a file outside of the rootDir
                if (typeof entry === 'string' && util.isParentOfPath(rootDir, filePathAbsolute) === false) {
                    throw new Error('Cannot reference a file outside of rootDir when using a top-level string. Please use a src;des; object instead');
                }
                result.push({
                    src: util.standardizePath(filePathAbsolute),
                    dest: this.getDestPath(filePathAbsolute, fileEntries, rootDir, true)
                });
            }
        }
        return result;
    }

    /**
     * Given a full path to a file, determine its dest path
     * @param srcPathAbsolute the path to the file. This MUST be a file path, and it is not verified to exist on the filesystem
     * @param files the files array
     * @param rootDir the absolute path to the root dir
     * @param skipMatch - skip running the minimatch process (i.e. assume the file is a match
     * @returns the RELATIVE path to the dest location for the file.
     */
    public getDestPath(srcPathAbsolute: string, files: FileEntry[], rootDir: string, skipMatch = false): string | undefined {
        //if the rootDir isn't absolute, convert it to absolute using the standard options flow
        if (path.isAbsolute(rootDir) === false) {
            rootDir = this.getOptions({ rootDir: rootDir }).rootDir;
        }
        //container for the files for this entry
        const standardizedFiles = this.normalizeFilesArray(files);
        let dest: string;

        //walk through the entire files array and find the last dest entry that matches
        for (let entry of standardizedFiles) {
            let srcGlobPattern = typeof entry === 'string' ? entry : entry.src;
            const isNegated = srcGlobPattern.startsWith('!');
            if (isNegated) {
                srcGlobPattern = srcGlobPattern.substring(1);
            }
            let isMatch: boolean;

            //if skipMatch is true, assume the file is a match and don't run the match function
            if (skipMatch === true) {
                isMatch = true;
            } else {
                //make the glob path absolute
                srcGlobPattern = path.resolve(util.toForwardSlashes(rootDir), srcGlobPattern);

                isMatch = minimatch(util.toForwardSlashes(srcPathAbsolute), srcGlobPattern);
            }

            //if not a match, move to the next pattern
            if (!isMatch) {
                continue;
            }
            //if this was a negated pattern, discard dest (i.e. exclude the file) and move to next pattern
            if (isNegated) {
                dest = undefined;
                continue;
            }

            //root-level files array strings are treated like file filters. These must be globs/paths relative to `rootDir`
            if (typeof entry === 'string') {
                //if the path is not found within the rootDir, this is not a match
                if (util.isParentOfPath(rootDir, srcPathAbsolute) === false) {
                    continue;
                }
                //normalize the path
                srcPathAbsolute = util.standardizePath(srcPathAbsolute);
                let srcPathRelative = util.stringReplaceInsensitive(srcPathAbsolute, rootDir, '');
                dest = util.standardizePath(`${srcPathRelative}`);
                continue;
            }

            //if this is an explicit file reference
            if (glob.hasMagic(entry.src) === false) {
                let isSrcPathAbsolute = path.isAbsolute(entry.src);
                let entrySrcPathAbsolute = isSrcPathAbsolute ? entry.src : util.standardizePath(`${rootDir}/${entry.src}`);

                let isSrcChildOfRootDir = util.isParentOfPath(rootDir, entrySrcPathAbsolute);

                let fileNameAndExtension = path.basename(entrySrcPathAbsolute);

                //no dest
                if (!entry.dest) {
                    //no dest, absolute path or file outside of rootDir
                    if (isSrcPathAbsolute || isSrcChildOfRootDir === false) {
                        //copy file to root of staging folder
                        dest = fileNameAndExtension;

                        //no dest, relative path, lives INSIDE rootDir
                    } else {
                        //copy relative file structure to root of staging folder
                        let srcPathRelative = util.stringReplaceInsensitive(entrySrcPathAbsolute, rootDir, '');
                        dest = srcPathRelative;
                    }

                    //assume entry.dest is the relative path to the folder AND file if applicable
                } else {
                    dest = entry.dest;
                }
                continue;
            }

            //if src contains double wildcard
            if (entry.src.includes('**')) {
                //run the glob lookup
                srcPathAbsolute = util.standardizePath(srcPathAbsolute);

                //matches should retain structure relative to star star
                let absolutePathToStarStar = path.resolve(rootDir, entry.src.split('**')[0]);
                let srcPathRelative = util.stringReplaceInsensitive(srcPathAbsolute, absolutePathToStarStar, '');

                dest = entry.dest ? entry.dest : '';
                dest = util.standardizePath(`${dest}/${srcPathRelative}`);
                continue;
            }

            //src is some other type of glob
            {
                let fileNameAndExtension = path.basename(srcPathAbsolute);
                dest = entry.dest ? entry.dest : '';
                dest = util.standardizePath(`${dest}/${fileNameAndExtension}`);
                continue;
            }
        }
        //remove any leading slash
        dest = typeof dest === 'string' ? dest.replace(/^[\/\\]*/, '') : undefined;
        return dest;
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

    private generateBaseRequestOptions(requestPath: string, options: RokuDeployOptions): request.OptionsWithUrl {
        options = this.getOptions(options);
        let url = `http://${options.host}:${options.packagePort}/${requestPath}`;
        let baseRequestOptions = {
            url: url,
            timeout: options.timeout,
            auth: {
                user: options.username,
                pass: options.password,
                sendImmediately: false
            }
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
        try {
            if ((await this.fsExtra.pathExists(zipFilePath)) === false) {
                throw new Error(`Cannot publish because file does not exist at '${zipFilePath}'`);
            }
            let readStream = this.fsExtra.createReadStream(zipFilePath);
            //wait for the stream to open (no harm in doing this, and it helps solve an issue in the tests)
            await new Promise((resolve) => {
                readStream.on('open', resolve);
            });
            let requestOptions = this.generateBaseRequestOptions('plugin_install', options);
            requestOptions.formData = {
                mysubmit: 'Replace',
                archive: readStream
            };

            if (options.remoteDebug) {
                requestOptions.formData.remotedebug = '1';
            }

            let results = await this.doPostRequest(requestOptions);
            if (options.failOnCompileError) {
                if (results.body.indexOf('Install Failure: Compilation Failed.') > -1) {
                    throw new errors.CompileError('Compile error', results);
                }
            }

            if (results.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                return { message: 'Identical to previous version -- not replacing', results: results };
            }
            return { message: 'Successful deploy', results: results };
        } finally {
            //delete the zip file only if configured to do so
            if (options.retainDeploymentArchive === false) {
                await this.fsExtra.remove(zipFilePath);
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
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options);
        requestOptions.formData = {
            archive: '',
            mysubmit: 'Convert to squashfs'
        };

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

        let requestOptions = this.generateBaseRequestOptions('plugin_inspect', options);
        requestOptions.formData = {
            mysubmit: 'Rekey',
            passwd: options.signingPassword,
            archive: this.fsExtra.createReadStream(rekeySignedPackagePath)
        };

        let results = await this.doPostRequest(requestOptions);
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

        let requestOptions = this.generateBaseRequestOptions('plugin_package', options);

        requestOptions.formData = {
            mysubmit: 'Package',
            pkg_time: (new Date()).getTime(), //eslint-disable-line camelcase
            passwd: options.signingPassword,
            app_name: appName //eslint-disable-line camelcase
        };

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

        await this.fsExtra.ensureDir(path.dirname(pkgFilePath));

        return new Promise<string>((resolve, reject) => {
            this.request.get(requestOptions)
                .on('error', (err) => reject(err))
                .on('response', (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error('Invalid response code: ' + response.statusCode));
                    }
                    resolve(pkgFilePath);
                })
                .pipe(this.fsExtra.createWriteStream(pkgFilePath));
        });
    }

    /**
     * Centralized function for handling POST http requests
     * @param params
     */
    private async doPostRequest(params: any, verify = true) {
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {
            this.request.post(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        if (verify) {
            this.checkRequest(results);
        }
        return results;
    }

    /**
     * Centralized function for handling GET http requests
     * @param params
     */
    private async doGetRequest(params: any) {
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {
            this.request.get(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        this.checkRequest(results);
        return results;
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
        let errors = [];
        let infos = [];
        let successes = [];
        let errorRegex = /Shell\.create\('Roku\.Message'\)\.trigger\('[\w\s]+',\s+'(\w+)'\)\.trigger\('[\w\s]+',\s+'(.*?)'\)/igm;
        let match;

        // eslint-disable-next-line no-cond-assign
        while (match = errorRegex.exec(body)) {
            let [, messageType, message] = match;
            switch (messageType.toLowerCase()) {
                case 'error':
                    errors.push(message);
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

        return { errors: errors, infos: infos, successes: successes };
    }

    /**
     * Create a zip of the project, and then publish to the target Roku device
     * @param options
     */
    public async deploy(options?: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => void) {
        options = this.getOptions(options);
        await this.createPackage(options, beforeZipCallback);
        await this.deleteInstalledChannel(options);
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
        return (await this.doPostRequest(deleteOptions));
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
    keyIndexes?: { [id: string]: number };
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
