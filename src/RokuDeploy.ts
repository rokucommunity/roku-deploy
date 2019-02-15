import * as path from 'path';
import * as fsExtra1 from 'fs-extra';
import * as Q from 'q';
import * as globAll from 'glob-all';
import * as request from 'request';
import * as fs from 'fs';
import * as archiver from 'archiver';
import * as ini from 'ini';
import * as dateformat from 'dateformat';

export class RokuDeploy {
    //store the import on the class to make testing easier
    public request = request;
    public fsExtra = fsExtra1;

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    public async prepublishToStaging(options: RokuDeployOptions) {
        options = this.getOptions(options);
        //cast some of the options as not null so we don't have to cast them below
        options.rootDir = <string>options.rootDir;
        options.outDir = <string>options.outDir;

        const files = this.normalizeFilesOption(options.files);

        //make all path references absolute
        this.makeFilesAbsolute(files, options.rootDir);

        let stagingFolderPath = this.getStagingFolderPath(options);

        //clean the staging directory
        await this.fsExtra.remove(stagingFolderPath);

        //make sure the staging folder exists
        await this.fsExtra.ensureDir(stagingFolderPath);
        await this.copyToStaging(files, stagingFolderPath, options.rootDir);
        return stagingFolderPath;
    }

    /**
     * Make all file references absolute
     * @param files
     * @param rootDir
     */
    public makeFilesAbsolute(files: { src: string[]; dest: string }[], rootDir: string) {
        //append the rootDir to every relative glob and string file entry
        for (let fileEntry of files) {
            for (let i = 0; i < fileEntry.src.length; i++) {
                let src = fileEntry.src[i];
                let isNegated = src.indexOf('!') === 0;
                if (isNegated) {
                    src = src.substring(1);
                }
                if (path.isAbsolute(src) === false) {
                    let absoluteSource = path.join(rootDir, src);
                    if (isNegated) {
                        absoluteSource = '!' + absoluteSource;
                    }
                    fileEntry.src[i] = absoluteSource;
                }
            }
        }
        return files;
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
     * Given an array of files, normalize them into a standard {src;dest} object.
     * This will make plain folder names into fully qualified paths, add globs to plain folders, etc.
     * This makes it easier to reason about later on in the process.
     * @param files
     */
    public normalizeFilesOption(files: FilesType[]) {
        const result: { src: string[]; dest: string }[] = [];
        let topLevelGlobs = <string[]>[];
        //standardize the files object
        for (let fileEntry of (files as any[])) {

            //handle single string top-level globs
            if (typeof fileEntry === 'string') {

                topLevelGlobs.push(fileEntry);
                continue;
                //handle src;dest; object with single string for src
            } else if (typeof fileEntry.src === 'string') {
                fileEntry.src = [fileEntry.src];
            }

            fileEntry.dest = fileEntry.dest ? fileEntry.dest : '';

            //hard-fail if dest is anything other than a string at this point
            if ('string' !== typeof fileEntry.dest) {
                throw new Error('dest must be a string');
            }

            //standardize the dest path separator
            fileEntry.dest = path.normalize(fileEntry.dest).trim();
            if (fileEntry.dest === '' || fileEntry.dest === '.' || fileEntry.dest === '.\\' || fileEntry.dest === './') {
                fileEntry.dest = '';
            }
            //force all slashes to the current platform's version
            fileEntry.dest = fileEntry.dest.replace('\\', path.sep).replace('/', path.sep);

            if (typeof fileEntry !== 'string' && (!fileEntry || fileEntry.src === null || fileEntry.src === undefined || fileEntry.dest === null || fileEntry.dest === undefined)) {
                throw new Error('Entry must be a string or a {src;dest;} object');
            }

            //if there is a wildcard in any src, ensure a slash in dest
            {
                let srcContainsWildcard = (fileEntry.src as Array<string>).findIndex((src) => {
                    return src.indexOf('*') > -1;
                }) > -1;

                if (fileEntry.dest.length > 0 && !this.endsWithSlash(fileEntry.dest) && srcContainsWildcard) {
                    fileEntry.dest += path.sep;
                }
            }

            result.push(fileEntry);
        }

        //if there are any top level globs, add that entry to the beginning
        if (topLevelGlobs.length > 0) {
            result.splice(0, 0, {
                src: topLevelGlobs,
                dest: ''
            });
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
    public async createPackage(options: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => void) {
        options = this.getOptions(options);

        await this.prepublishToStaging(options);

        let stagingFolderPath = this.getStagingFolderPath(options);
        let manifestPath = path.join(stagingFolderPath, 'manifest');
        let parsedManifest = await this.parseManifest(manifestPath);

        if (options.incrementBuildNumber) {
            let timestamp = dateformat(new Date(), 'yymmddHHMM');
            parsedManifest.build_version = timestamp;
            await this.fsExtra.writeFile(manifestPath, ini.stringify(parsedManifest));
        }

        if (beforeZipCallback) {
            let info: BeforeZipCallbackInfo = {
                manifestData: parsedManifest,
                stagingFolderPath: stagingFolderPath
            };

            beforeZipCallback(info);
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
     */
    public async getFilePaths(files: FilesType[], stagingPath: string, rootDir: string) {
        stagingPath = path.normalize(stagingPath);
        const normalizedFiles = this.normalizeFilesOption(files);

        rootDir = this.normalizeRootDir(rootDir);

        //run glob lookups for every glob string provided
        let filePathObjects = await Promise.all(
            normalizedFiles.map(async (file) => {
                let pathRemoveFromDest: string;
                //if we have a single string, and it's a directory, append the wildcard glob on it
                if (file.src.length === 1) {
                    let fileAsDirPath: string;
                    //try the path as is
                    if (await this.isDirectory(file.src[0])) {
                        fileAsDirPath = file.src[0];
                    }
                    /* istanbul ignore next */
                    //assume path is relative, append root dir and try that way
                    if (!fileAsDirPath && await this.isDirectory(path.join(rootDir, file.src[0]))) {
                        fileAsDirPath = path.normalize(path.join(rootDir, file.src[0]));
                    }
                    if (fileAsDirPath) {
                        pathRemoveFromDest = fileAsDirPath;

                        //add the wildcard glob
                        file.src[0] = path.join(fileAsDirPath, '**', '*');
                    }
                }
                let originalSrc = file.src;

                let filePathArray = await Q.nfcall(globAll, file.src, { cwd: rootDir });
                let output = <{ src: string; dest: string; srcOriginal?: string; }[]>[];

                for (let filePath of filePathArray) {
                    let dest = file.dest;

                    //if we created this globbed result, maintain the relative position of the files
                    if (pathRemoveFromDest) {
                        let normalizedFilePath = path.normalize(filePath);
                        //remove the specified source path
                        dest = normalizedFilePath.replace(pathRemoveFromDest, '');
                        //remove the filename if it's a file
                        if (await this.isDirectory(filePath) === false) {
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
            fileObjects = fileObjects.concat(filePathObject);
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
            fileObject.src = path.normalize(fileObject.src);
        }

        let result: { src: string; dest: string; }[] = [];
        //copy each file, retaining their folder structure relative to the rootDir
        await Promise.all(
            fileObjects.map(async (fileObject) => {
                let src = path.normalize(fileObject.src);
                let dest = fileObject.dest;
                let sourceIsDirectory = await this.isDirectory(src);

                let relativeSrc: string;
                //if we have an original src, and it contains the ** glob, use the relative position starting at **
                let globDoubleStarIndex = fileObject.srcOriginal ? fileObject.srcOriginal.indexOf('**') : -1;

                if (fileObject.srcOriginal && globDoubleStarIndex > -1 && sourceIsDirectory === false) {
                    let pathToDoubleStar = fileObject.srcOriginal.substring(0, globDoubleStarIndex);
                    relativeSrc = src.replace(pathToDoubleStar, '');
                    dest = path.join(dest, relativeSrc);
                } else {
                    let rootDirWithTrailingSlash = path.normalize(rootDir + path.sep);
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
     * Determine if the given path is a directory
     * @param path
     */
    public async isDirectory(pathToDirectoryOrFile: string) {
        try {
            let stat = await Q.nfcall(fs.lstat, pathToDirectoryOrFile);
            return stat.isDirectory();
        } catch (e) {
            // lstatSync throws an error if path doesn't exist
            return false;
        }
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
            throw new Error('must specify the host for the Roku device');
        }
        let zipFilePath = this.getOutputZipFilePath(options);
        let requestOptions = this.generateBaseRequestOptions('plugin_install', options);
        requestOptions.formData = {
            mysubmit: 'Replace',
            archive: fs.createReadStream(zipFilePath)
        };

        let results = await this.doPostRequest(requestOptions);

        let error: any;
        if (!results || !results.response || typeof results.body !== 'string') {
            error = new Error('Invalid response');
            (error as any).results = results;
            throw error;
        }

        if (options.failOnCompileError) {
            if (results.body.indexOf('Install Failure: Compilation Failed.') > -1) {
                error = new Error('Compile error');
                console.log(results.body);

                (error as any).results = results;
                throw error;
            }
        }

        if (results.response.statusCode === 200) {
            if (results.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                return { message: 'Identical to previous version -- not replacing', results: results };
            }
            return { message: 'Successful deploy', results: results };
        } else {
            if (results.response.statusCode === 401) {
                error = new Error('Unauthorized. Please verify username and password for target Roku.');
            } else {
                error = new Error('Error, statusCode other than 200: ' + results.response.statusCode);
            }
            error.results = results;
            throw error;
        }
    }

    /**
     * Sign a pre-existing package using Roku and return path to retrieve it
     * @param options
     */
    public async signExistingPackage(options: RokuDeployOptions): Promise<string> {
        options = this.getOptions(options);
        if (!options.signingPassword) {
            throw new Error('Must supply signingPassword');
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

        return new Promise<any>((resolve, reject) => {
            this.request.post(requestOptions, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        }).then((results) => {
            let error: any;
            if (!results || !results.response || typeof results.body !== 'string') {
                error = new Error('Invalid response');
                error.results = results;
                return Promise.reject(error);
            }

            let failedSearchMatches = /<font.*>Failed: (.*)/.exec(results.body);
            if (failedSearchMatches) {
                error = new Error(failedSearchMatches[1]);
                error.results = results;
                return Promise.reject<any>(error);
            }

            let pkgSearchMatches = /<a href="(pkgs\/[^\.]+\.pkg)">/.exec(results.body);
            if (pkgSearchMatches) {
                return pkgSearchMatches[1];
            }

            error = new Error('Unknown error signing package');
            error.results = results;
            return Promise.reject(error);
        });
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
                .pipe(fs.createWriteStream(pkgFilePath));
        });
    }

    /**
     * Centralized function for handling http requests
     * @param params 
     */
    private doPostRequest(params: any): Promise<{ response: any; body: any }> {
        return new Promise((resolve, reject) => {
            this.request.post(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
    }

    /**
     * Create a zip of the project, and then publish to the target Roku device
     * @param options
     */
    public async deploy(options?: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => void) {
        options = this.getOptions(options);
        await this.createPackage(options, beforeZipCallback);
        let result = await this.publish(options);
        return result;
    }

    /**
     * executes sames steps as deploy and signs the package and stores it in the out folder
     * @param options
     */
    public async  deployAndSignPackage(options?: RokuDeployOptions, beforeZipCallback?: (info: BeforeZipCallbackInfo) => void): Promise<string> {
        options = this.getOptions(options);
        let originalOptionValueRetainStagingFolder = options.retainStagingFolder;
        options.retainStagingFolder = true;
        await this.deploy(options, beforeZipCallback);
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

        let stagingFolderPath = path.join(options.outDir, '.roku-deploy-staging');
        stagingFolderPath = path.resolve(stagingFolderPath);
        return stagingFolderPath;
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

    public async parseManifest(manifestPath: string): Promise<ManifestData> {
        if (!await this.fsExtra.pathExists(manifestPath)) {
            throw new Error(manifestPath + ' does not exist');
        }

        let manifestContents = await this.fsExtra.readFile(manifestPath, 'utf-8');
        let parsedManifest = ini.parse(manifestContents);
        return parsedManifest;
    }

    /**
     * Given a path to a folder, zip up that folder and all of its contents
     * @param srcFolder
     * @param zipFilePath
     */
    public zipFolder(srcFolder: string, zipFilePath: string) {
        return new Promise((resolve, reject) => {
            let output = fs.createWriteStream(zipFilePath);
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
     * @default "./out"
     */
    outDir?: string;
    /**
     * The base filename the zip/pkg file should be given (excluding the extension)
     * @default "roku-deploy"
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
            "source/**\/*.*",
            "components/**\/*.*",
            "images/**\/*.*",
            "manifest"
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
     * The IP address or hostname of the target Roku device.
     * @required
     * @example "192.168.1.21"
     *
     */
    host?: string;
    /**
     * The username for the roku box. This will always be 'rokudev', but allows to be overridden
     * just in case roku adds support for custom usernames in the future
     * @default "rokudev"
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
     * If true we increment the build number to be a timestamp in the format yymmddHHMM
     * @required
     */
    incrementBuildNumber?: boolean;
    /**
     * If true, the publish will fail on compile error
     */
    failOnCompileError?: boolean;
}

export interface ManifestData {
    [key: string]: string;
}

export interface BeforeZipCallbackInfo {
    /**
     * Contains an associative array of the parsed values in the manifest
     */
    manifestData: ManifestData;
    stagingFolderPath: string;
}

export type FilesType = (string | string[] | { src: string | string[]; dest?: string });
