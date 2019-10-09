import * as path from 'path';
import * as _fsExtra from 'fs-extra';
import * as request from 'request';
import * as archiver from 'archiver';
import * as dateformat from 'dateformat';
import * as errors from './Errors';
import * as denodeify from 'denodeify';
const glob = denodeify(require('glob'));

import { util, Util } from './util';
import { scrypt } from 'crypto';

export class RokuDeploy {
    //store the import on the class to make testing easier
    public request = request;
    public fsExtra = _fsExtra;

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async prepublishToStaging(options: RokuDeployOptions) {
        options = this.getOptions(options);
        //cast some of the options as not null so we don't have to cast them below
        options.rootDir = <string>options.rootDir;
        options.outDir = <string>options.outDir;

        const files = this.normalizeFilesArray(options.files);

        let stagingFolderPath = this.getStagingFolderPath(options);

        //clean the staging directory
        await this.fsExtra.remove(stagingFolderPath);

        //make sure the staging folder exists
        await this.fsExtra.ensureDir(stagingFolderPath);
        await this.copyToStaging(files, stagingFolderPath, options.rootDir);
        return stagingFolderPath;
    }

    /**
     * Determine if a given string ends in a file system slash (\ for windows and / for everything else)
     * @param dirPath
     */
    public endsWithSlash(dirPath: string) {
        if ('string' === typeof dirPath && dirPath.length > 0 &&
            (dirPath.lastIndexOf('/') === dirPath.length - 1 || dirPath.lastIndexOf('\\') === dirPath.length - 1)
        ) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Given an array of `FilesType`, normalize each of them into a standard {src;dest} object.
     * Each entry in the array or inner `src` array will be extracted out into its own object.
     * This makes it easier to reason about later on in the process.
     * @param files
     */
    public normalizeFilesArray(files: FilesType[]) {
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

        let stagingFolderPath = this.getStagingFolderPath(options);

        //make sure the output folder exists
        await this.fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options);

        //create a zip of the staging folder
        await this.zipFolder(stagingFolderPath, zipFilePath);

        //delete the staging folder unless told to retain it.
        if (options.retainStagingFolder !== true) {
            await this.fsExtra.remove(stagingFolderPath);
        }
    }

    /**
     * Create a zip folder containing all of the specified roku project files.
     * @param options
     */
    public async createPackage(options: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => Promise<void> | void) {
        options = this.getOptions(options);

        await this.prepublishToStaging(options);

        let stagingFolderPath = this.getStagingFolderPath(options);
        let manifestPath = path.join(stagingFolderPath, 'manifest');
        let parsedManifest = await this.parseManifest(manifestPath);

        if (options.incrementBuildNumber) {
            let timestamp = dateformat(new Date(), 'yymmddHHMM');
            parsedManifest.build_version = timestamp;
            await this.fsExtra.writeFile(manifestPath, this.stringifyManifest(parsedManifest));
        }

        if (beforeZipCallback) {
            let info: BeforeZipCallbackInfo = {
                manifestData: parsedManifest,
                stagingFolderPath: stagingFolderPath
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
     * @param rootDir - the absolute path to the root dir where relative files entries are relative to
     */
    public async getFilePaths(files: FilesType[], stagingFolderPath: string, rootDir: string): Promise<any> {
        stagingFolderPath = util.standardizePath(stagingFolderPath);
        const normalizedFiles = this.normalizeFilesArray(files);

        let result = [] as StandardizedFileEntry[];

        for (let entry of normalizedFiles) {
            let src = typeof entry === 'string' ? entry : entry.src;

            //if starts with !, this is a negated glob. 
            let isNegated = src.indexOf('!') === 0;

            //remove the ! so the glob will match properly
            if (isNegated) {
                src = src.substring(1);
            }

            let entryResults = await this.getFilePathsForEntry(
                typeof entry === 'string' ? src : { ...entry, src: src },
                stagingFolderPath,
                rootDir
            );

            //if negated, remove all of the negated matches from the results
            if (isNegated) {
                let paths = entryResults.map(x => x.src);
                result.filter(x => paths.indexOf(x.src) === -1);

                //add all of the entries to the results
            } else {
                result.push(...entryResults);
            }
        }

        return result;
    }

    private async getFilePathsForEntry(entry: StandardizedFileEntry | string, stagingFolderPath: string, rootDir: string) {
        //container for the files for this entry
        let result = [] as StandardizedFileEntry[];

        //root-level files array strings are treated like file filters. These must be globs/paths relative to `rootDir`
        if (typeof entry === 'string') {
            let files: string[] = await glob(entry, { cwd: rootDir, absolute: true });
            for (let srcPathAbsolute of files) {
                if ((await util.isParentOfPath(rootDir, srcPathAbsolute)) === false) {
                    throw new Error('Top-level patterns may not reference files outside of rootDir');
                }
                //normalize the path
                srcPathAbsolute = util.standardizePath(srcPathAbsolute);
                let srcPathRelative = util.stringReplaceInsensitive(srcPathAbsolute, rootDir, '');
                if (await util.isFile(srcPathAbsolute)) {
                    result.push({
                        src: srcPathAbsolute,
                        dest: util.standardizePath(`${stagingFolderPath}/${srcPathRelative}`)
                    });
                }
            }
        } else if (await util.isFile(entry.src, rootDir)) {
            let isSrcPathAbsolute = path.isAbsolute(entry.src);
            let srcPathAbsolute = isSrcPathAbsolute ?
                entry.src :
                util.standardizePath(`${rootDir}/${entry.src}`);

            let isSrcChildOfRootDir = util.isParentOfPath(rootDir, srcPathAbsolute);

            let fileNameAndExtension = path.basename(srcPathAbsolute);

            let destPath: string;

            //no dest
            if (!entry.dest) {

                //no dest, absolute path or file outside of rootDir
                if (isSrcPathAbsolute || isSrcChildOfRootDir === false) {
                    //copy file to root of staging folder
                    destPath = util.standardizePath(`${stagingFolderPath}/${fileNameAndExtension}`);

                    //no dest, relative path, lives INSIDE rootDir
                } else {
                    //copy relative file structure to root of staging folder
                    let srcPathRelative = util.stringReplaceInsensitive(srcPathAbsolute, rootDir, '');
                    destPath = util.standardizePath(`${stagingFolderPath}/${srcPathRelative}`);
                }

                //dest ends with slash (indicating it's a folder)
            } else if (entry.dest.endsWith(path.sep)) {
                //keep the filename, but put it in the dest folder
                destPath = util.standardizePath(`${stagingFolderPath}/${entry.dest}/${fileNameAndExtension}`);

                //dest includes the filename (and extension if applicable)
            } else {
                destPath = util.standardizePath(`${stagingFolderPath}/${entry.dest}`);
            }

            result.push({
                src: util.standardizePath(srcPathAbsolute),
                dest: destPath
            });

            //if src contains double wildcard folder
        } else if (entry.src.indexOf('**') > -1) {

            //run the glob lookup
            let files: string[] = await glob(entry.src, { cwd: rootDir, absolute: true });
            for (let srcPathAbsolute of files) {
                srcPathAbsolute = util.standardizePath(srcPathAbsolute);
                let entryStagingFolderPath = entry.dest ?
                    path.resolve(stagingFolderPath, entry.dest) :
                    stagingFolderPath;

                //matches should retain structure relative to star star
                let absolutePathToStarStar = path.resolve(rootDir, entry.src.split('**')[0]);
                let srcPathRelative = util.stringReplaceInsensitive(srcPathAbsolute, absolutePathToStarStar, '');

                //only keep files (i.e. discard directory paths)
                if (await util.isFile(srcPathAbsolute)) {
                    result.push({
                        src: srcPathAbsolute,
                        dest: util.standardizePath(`${entryStagingFolderPath}/${srcPathRelative}`)
                    });
                }
            }

            //if src is some other type of glob 
        } else {
            //run the glob lookup
            let files: string[] = await glob(entry.src, { cwd: rootDir, absolute: true });
            for (let srcPathAbsolute of files) {
                srcPathAbsolute = util.standardizePath(srcPathAbsolute);
                let entryStagingFolderPath = entry.dest ?
                    path.resolve(stagingFolderPath, entry.dest) :
                    stagingFolderPath;

                let srcPathRelative = util.stringReplaceInsensitive(srcPathAbsolute, rootDir, '');

                //only keep files (i.e. discard directory paths)
                if (await util.isFile(srcPathAbsolute)) {
                    result.push({
                        src: srcPathAbsolute,
                        dest: util.standardizePath(`${entryStagingFolderPath}/${srcPathRelative}`)
                    });
                }
            }
        }

        return result;
    }

    /**
     * Get all file paths for the specified options
     */
    public async getFilePaths_old(files: FilesType[], stagingPath: string, rootDir: string) {
        stagingPath = util.standardizePath(stagingPath);
        const normalizedFiles = this.normalizeFilesArray(files) as any;

        rootDir = this.normalizeRootDir(rootDir);

        //run glob lookups for every glob string provided
        let filePathObjects = await Promise.all(
            normalizedFiles.map(async (file) => {
                let pathRemoveFromDest: string;
                //if we have a single string, and it's a directory, append the wildcard glob on it
                if (file.src.length === 1) {
                    let fileAsDirPath: string;
                    //try the path as is
                    if (await util.isDirectory(file.src[0])) {
                        fileAsDirPath = file.src[0];
                    }

                    //assume path is relative, prepend root dir and try that way
                    if (!fileAsDirPath && await util.isDirectory(path.join(rootDir, file.src[0]))) {
                        fileAsDirPath = util.standardizePath(path.join(rootDir, file.src[0]));
                    }
                    if (fileAsDirPath) {
                        pathRemoveFromDest = fileAsDirPath;

                        //add the wildcard glob
                        file.src[0] = path.join(fileAsDirPath, '**', '*');
                    }
                }

                //prepend rootDir to any paths starting with wildcards
                for (let i = 0; i < file.src.length; i++) {
                    let srcPath = file.src[i];
                    if (srcPath.indexOf('**') === 0) {
                        file.src[i] = util.standardizePath(`${rootDir}/${srcPath}`);
                        //negated 
                    } else if (srcPath.indexOf('!**') === 0) {
                        //remove the 
                        file.src[i] = '!' + util.standardizePath(`${rootDir}/${srcPath.substring(1)}`);
                    }
                }

                let originalSrc = file.src;

                let filePathArray = []; // await Q.nfcall(globAll, file.src, { cwd: rootDir });
                let output = <{ src: string; dest: string; srcOriginal?: string; }[]>[];

                for (let filePath of filePathArray) {
                    let dest = file.dest;

                    //if we created this globbed result, maintain the relative position of the files
                    if (pathRemoveFromDest) {
                        let normalizedFilePath = util.standardizePath(filePath);
                        //remove the specified source path
                        dest = normalizedFilePath.replace(pathRemoveFromDest, '');
                        //remove the filename if it's a file
                        if (await util.isDirectory(filePath) === false) {
                            dest = path.dirname(dest);
                        }
                        //prepend the specified dest
                        dest = path.join(file.dest, dest, path.basename(normalizedFilePath));
                        //blank out originalSrc since we already handled the dest
                        originalSrc = [];
                    }

                    //create a src;dest; object for every file or directory that was found
                    output.push({
                        src: filePath,
                        dest: dest,
                        srcOriginal: originalSrc.length === 1 ? originalSrc[0] : undefined
                    });
                }
                return output;
            })
        );

        let fileObjects = <{ src: string; dest: string; srcOriginal?: string; }[]>[];
        //create a single array of all paths
        for (let filePathObject of filePathObjects) {
            fileObjects = fileObjects.concat(filePathObject as any);
        }

        //make all file paths absolute
        for (let fileObject of fileObjects) {
            //only normalize non-absolute paths
            if (path.isAbsolute(fileObject.src) === false) {
                fileObject.src = path.resolve(
                    path.join(rootDir, fileObject.src)
                );
            }
            //normalize the path
            fileObject.src = util.standardizePath(fileObject.src);
        }

        let result: StandardizedFileEntry[] = [];
        //copy each file, retaining their folder structure relative to the rootDir
        await Promise.all(
            fileObjects.map(async (fileObject) => {
                let src = util.standardizePath(fileObject.src);
                let dest = fileObject.dest;
                let sourceIsDirectory = await util.isDirectory(src);

                let relativeSrc: string;
                //if we have an original src, and it contains the ** glob, use the relative position starting at **
                let globDoubleStarIndex = fileObject.srcOriginal ? fileObject.srcOriginal.indexOf('**') : -1;

                if (fileObject.srcOriginal && globDoubleStarIndex > -1 && sourceIsDirectory === false) {
                    let pathToDoubleStar = fileObject.srcOriginal.substring(0, globDoubleStarIndex);
                    relativeSrc = src.replace(pathToDoubleStar, '');
                    dest = path.join(dest, relativeSrc);
                } else {
                    let rootDirWithTrailingSlash = util.standardizePath(rootDir + path.sep);
                    relativeSrc = src.replace(rootDirWithTrailingSlash, '');
                }

                //if item is a directory
                if (sourceIsDirectory) {
                    //source is a directory (which is only possible when glob resolves it as such)
                    //do nothing, because we don't want to copy empty directories to output
                } else {
                    let destinationPath: string;

                    //if the relativeSrc is stil absolute, then this file exists outside of the rootDir. Copy to dest, and only retain filename from src
                    if (path.isAbsolute(relativeSrc)) {
                        destinationPath = path.join(stagingPath, dest, path.basename(relativeSrc));
                    } else {
                        //the relativeSrc is actually relative

                        //if the dest ends in a slash, use the filename from src, but the folder structure from dest
                        if (dest.endsWith(path.sep)) {
                            destinationPath = path.join(stagingPath, dest, path.basename(src));

                            //dest is empty, so use the relative path
                        } else if (dest === '') {
                            destinationPath = path.join(stagingPath, relativeSrc);

                            //use all of dest
                        } else {
                            destinationPath = path.join(stagingPath, dest);
                        }
                    }
                    fileObject.dest = destinationPath;

                    delete fileObject.srcOriginal;
                    //add the file object to the results
                    result.push(fileObject);
                }
            })
        );
        return result;
    }

    /**
     * Copy all of the files to the staging directory
     * @param fileGlobs
     * @param stagingPath
     */
    private async copyToStaging(files: FilesType[], stagingPath: string, rootDir: string) {
        let fileObjects = await this.getFilePaths(files, stagingPath, rootDir);
        for (let fileObject of fileObjects) {
            //make sure the containing folder exists
            await this.fsExtra.ensureDir(path.dirname(fileObject.dest));

            //sometimes the copyfile action fails due to race conditions (normally to poorly constructed src;dest; objects with duplicate files in them
            //Just try a few fimes until it resolves itself.

            for (let i = 0; i < 10; i++) {
                try {
                    //copy the src item (file or directory full of files)
                    await this.fsExtra.copy(fileObject.src, fileObject.dest, {
                        //copy the actual files that symlinks point to, not the symlinks themselves
                        dereference: true
                    });
                    //copy succeeded,
                    i = 10; //break out of the loop and still achieve coverage for i++
                } catch (e) {
                    //wait a small amount of time and try again
                    /* istanbul ignore next */
                    await new Promise((resolve) => {
                        setTimeout(resolve, 50);
                    });
                }
            }
        }
    }

    private generateBaseRequestOptions(requestPath: string, options: RokuDeployOptions): request.OptionsWithUrl {
        let url = `http://${options.host}/${requestPath}`;
        let baseRequestOptions = {
            url: url,
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
     * @param host
     */
    public async pressHomeButton(host) {
        // press the home button to return to the main screen
        return await this.doPostRequest({
            url: `http://${host}:8060/keypress/Home`
        });
    }

    /**
     * Publish a pre-existing packaged zip file to a remote Roku.
     * @param options
     */
    public async publish(options: RokuDeployOptions): Promise<{ message: string, results: any }> {
        options = this.getOptions(options);
        if (!options.host) {
            throw new errors.MissingRequiredOptionError('must specify the host for the Roku device');
        }
        //make sure the outDir exists
        await this.fsExtra.ensureDir(options.outDir);

        let zipFilePath = this.getOutputZipFilePath(options);
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options);
        requestOptions.formData = {
            mysubmit: 'Replace',
            archive: this.fsExtra.createReadStream(zipFilePath)
        };

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
        let stagingFolderpath = this.getStagingFolderPath(options);
        let manifestPath = path.join(stagingFolderpath, 'manifest');
        let parsedManifest = await this.parseManifest(manifestPath);
        let appName = parsedManifest.title + '/' + parsedManifest.major_version + '.' + parsedManifest.minor_version;

        let requestOptions = this.generateBaseRequestOptions('plugin_package', options);

        requestOptions.formData = {
            mysubmit: 'Package',
            pkg_time: (new Date()).getTime(),
            passwd: options.signingPassword,
            app_name: appName,
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
    private async doPostRequest(params: any) {
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {
            this.request.post(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        this.checkRequest(results);
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

        if (results.response.statusCode === 401) {
            throw new errors.UnauthorizedDeviceResponseError('Unauthorized. Please verify username and password for target Roku.', results);
        }

        if (results.response.statusCode !== 200) {
            throw new errors.InvalidDeviceResponseCodeError('Invalid response code: ' + results.response.statusCode);
        }
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
            await this.fsExtra.remove(this.getStagingFolderPath(options));
        }
        return localPkgFilePath;
    }

    /**
     * Get an options with all overridden vaues, and then defaults for missing values
     * @param options
     */
    public getOptions(options: RokuDeployOptions = {}) {
        let fileOptions: RokuDeployOptions = {};
        //load a rokudeploy.json file if it exists
        if (this.fsExtra.existsSync('rokudeploy.json')) {
            let configFileText = this.fsExtra.readFileSync('rokudeploy.json').toString();
            fileOptions = JSON.parse(configFileText);
        }

        let defaultOptions = <RokuDeployOptions>{
            outDir: './out',
            outFile: 'roku-deploy',
            retainStagingFolder: false,
            incrementBuildNumber: false,
            failOnCompileError: true,
            rootDir: './',
            files: [
                'source/**/*.*',
                'components/**/*.*',
                'images/**/*.*',
                'manifest'
            ],
            username: 'rokudev'
        };

        //override the defaults with any found or provided options
        let finalOptions = Object.assign({}, defaultOptions, fileOptions, options);

        //fully resolve the folder paths
        finalOptions.rootDir = path.resolve(finalOptions.rootDir);
        finalOptions.outDir = path.resolve(finalOptions.outDir);

        return finalOptions;
    }

    public getStagingFolderPath(options?: RokuDeployOptions) {
        options = this.getOptions(options);

        if (options.stagingFolderPath) {
            return path.resolve(options.stagingFolderPath);
        } else {
            let stagingFolderPath = path.join(options.outDir, '.roku-deploy-staging');
            stagingFolderPath = path.resolve(stagingFolderPath);
            return stagingFolderPath;
        }
    }

    /**
     * Centralizes getting output zip file path based on passed in options
     * @param options
     */
    public getOutputZipFilePath(options: RokuDeployOptions) {
        options = this.getOptions(options);

        let zipFileName = <string>options.outFile;
        if (zipFileName.indexOf('.zip') < 0) {
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

        let pkgFileName = <string>options.outFile;
        if (pkgFileName.indexOf('.zip') < 0) {
            pkgFileName += '.pkg';
        } else {
            pkgFileName = pkgFileName.replace('.zip', '.pkg');
        }
        let outFolderPath = path.resolve(options.outDir);

        let outPkgFilePath = path.join(outFolderPath, pkgFileName);
        return outPkgFilePath;
    }

    public async getDevId(options?: RokuDeployOptions) {
        options = this.getOptions(options);

        let requestOptions = this.generateBaseRequestOptions('plugin_package', options);
        let results = await this.doGetRequest(requestOptions);

        let devIdSearchMatches = /Your Dev ID:[^>]+>([^<]+)</.exec(results.body);
        if (devIdSearchMatches) {
            return devIdSearchMatches[1].trim();
        }

        throw new errors.UnparsableDeviceResponseError('Could not retrieve Dev ID', results);
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
        manifestLines.map((line, index) => {
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
    public zipFolder(srcFolder: string, zipFilePath: string) {
        return new Promise((resolve, reject) => {
            let output = this.fsExtra.createWriteStream(zipFilePath);
            let archive = archiver('zip');

            output.on('close', () => {
                resolve();
            });

            output.on('error', (err) => {
                reject(err);
            });

            /* istanbul ignore next */
            archive.on('warning', (err) => {
                if (err.code === 'ENOENT') {
                    console.warn(err);
                } else {
                    reject(err);
                }
            });

            /* istanbul ignore next */
            archive.on('error', (err) => {
                reject(err);
            });

            archive.pipe(output);

            //add every file in the source folder
            archive.directory(srcFolder, false);

            //finalize the archive
            archive.finalize();
        });
    }
}

export interface RokuDeployOptions {
    /**
     * A full path to the folder where the zip/pkg package should be placed
     * @default './out'
     */
    outDir?: string;

    /**
     * The base filename the zip/pkg file should be given (excluding the extension)
     * @default 'roku-deploy'
     */
    outFile?: string;

    /**
     * The root path to the folder holding your Roku project's source files (manifest, components/, source/ should be directly under this folder)
     * @default './'
     */
    rootDir?: string;

    // tslint:disable:jsdoc-format
    /**
     * An array of source file paths, source file globs, or {src,dest} objects indicating
     * where the source files are and where they should be placed
     * in the output directory
     * @default [
            'source/**\/*.*',
            'components/**\/*.*',
            'images/**\/*.*',
            'manifest'
        ],
     */
    // tslint:enable:jsdoc-format
    files?: FilesType[];

    /**
     * Set this to true to prevent the staging folder from being deleted after creating the package
     * @default false
     */
    retainStagingFolder?: boolean;

    /**
     * The path where roku-deploy should stage all of the files right before being zipped. defaults to ${outDir}/.roku-deploy-staging
     */
    stagingFolderPath?: string;

    /**
     * The IP address or hostname of the target Roku device.
     * @required
     * @example '192.168.1.21'
     *
     */
    host?: string;

    /**
     * The username for the roku box. This will always be 'rokudev', but allows to be overridden
     * just in case roku adds support for custom usernames in the future
     * @default 'rokudev'
     */
    username?: string;

    /**
     * The password for logging in to the developer portal on the target Roku device
     * @required
     */
    password?: string;

    /**
     * The password used for creating signed packages
     * @required
     */
    signingPassword?: string;

    /**
     * Path to a copy of the signed package you want to use for rekeying
     * @required
     */
    rekeySignedPackage?: string;

    /**
     * Dev ID we are expecting the device to have. If supplied we check that the dev ID returned after keying matches what we expected
     */
    devId?: string;

    /**
     * If true we increment the build number to be a timestamp in the format yymmddHHMM
     */
    incrementBuildNumber?: boolean;

    /**
     * If true we convert to squashfs before creating the pkg file
     */
    convertToSquashfs?: boolean;

    /**
     * If true, the publish will fail on compile error
     */
    failOnCompileError?: boolean;
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
    src: string;
    dest: string;
}

export type FilesType = (string | string[] | { src: string | string[]; dest?: string });
