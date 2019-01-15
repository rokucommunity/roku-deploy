import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as Q from 'q';
import * as globAll from 'glob-all';
import * as request from 'request';
import * as fs from 'fs';
import * as archiver from 'archiver';
// tslint:disable-next-line
export var __request: any = request;

/**
 * Copies all of the referenced files to the staging folder
 * @param options 
 */
export async function prepublishToStaging(options: RokuDeployOptions) {
    options = getOptions(options);
    //cast some of the options as not null so we don't have to cast them below
    options.rootDir = <string>options.rootDir;
    options.outDir = <string>options.outDir;

    const files = await normalizeFilesOption(options.files, options.rootDir);

    //make all path references absolute
    makeFilesAbsolute(files, options.rootDir);

    //create the staging folder if it doesn't already exist
    let stagingFolderPath = path.join(options.outDir, '.roku-deploy-staging');
    stagingFolderPath = path.resolve(stagingFolderPath);

    //clean the staging directory
    await fsExtra.remove(stagingFolderPath);

    //make sure the staging folder exists
    await fsExtra.ensureDir(stagingFolderPath);
    await copyToStaging(files, stagingFolderPath, options.rootDir);
    return stagingFolderPath;
}

/**
 * Make all file references absolute
 * @param files 
 * @param rootDir 
 */
export function makeFilesAbsolute(files: { src: string[]; dest: string }[], rootDir: string) {
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
export function endsWithSlash(dirPath: string) {
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
 * @param rootDir 
 */
export async function normalizeFilesOption(files: FilesType[], rootDir: string = './') {
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

            if (fileEntry.dest.length > 0 && !endsWithSlash(fileEntry.dest) && srcContainsWildcard) {
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
export async function zipPackage(options: RokuDeployOptions) {
    options = getOptions(options);

    //create the staging folder if it doesn't already exist
    let stagingFolderPath = path.join(options.outDir, '.roku-deploy-staging');
    stagingFolderPath = path.resolve(stagingFolderPath);

    let outFolderPath = path.resolve(options.outDir);
    //make sure the output folder exists
    await fsExtra.ensureDir(outFolderPath);
    let outFilePath = path.join(outFolderPath, <string>options.outFile);

    //create a zip of the staging folder
    await zipFolder(stagingFolderPath, outFilePath);

    //delete the staging folder unless told to retain it.
    if (options.retainStagingFolder !== true) {
        await fsExtra.remove(stagingFolderPath);
    }
}

/**
 * Create a zip folder containing all of the specified roku project files.
 * @param options 
 */
export async function createPackage(options: RokuDeployOptions) {
    await prepublishToStaging(options);
    await zipPackage(options);
}

/**
 * Get all file paths for the specified options
 */
async function getFilePaths(files: FilesType[], stagingPath: string, rootDir: string) {
    stagingPath = path.normalize(stagingPath);
    const normalizedFiles = await normalizeFilesOption(files, '');

    //run glob lookups for every glob string provided
    let filePathObjects = await Promise.all(
        normalizedFiles.map(async (file) => {
            let pathRemoveFromDest: string;
            //if we have a single string, and it's a directory, append the wildcard glob on it
            if (file.src.length === 1) {
                let fileAsDirPath: string;
                //try the path as is
                if (await isDirectory(file.src[0])) {
                    fileAsDirPath = file.src[0];
                }
                /* istanbul ignore next */
                //assume path is relative, append root dir and try that way
                if (!fileAsDirPath && await isDirectory(path.join(rootDir, file.src[0]))) {
                    fileAsDirPath = path.normalize(path.join(rootDir, file.src[0]));
                }
                if (fileAsDirPath) {
                    pathRemoveFromDest = fileAsDirPath;

                    //add the wildcard glob
                    file.src[0] = path.join(fileAsDirPath, '**', '*');
                }
            }
            let originalSrc = file.src;

            let filePathArray = await Q.nfcall(globAll, file.src);
            let output = <{ src: string; dest: string; srcOriginal?: string; }[]>[];

            for (let filePath of filePathArray) {
                let dest = file.dest;

                //if we created this globbed result, maintain the relative position of the files
                if (pathRemoveFromDest) {
                    let normalizedFilePath = path.normalize(filePath);
                    //remove the specified source path
                    dest = normalizedFilePath.replace(pathRemoveFromDest, '');
                    //remove the filename if it's a file
                    if (await isDirectory(filePath) === false) {
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
        fileObject.src = path.resolve(fileObject.src);
    }

    let result: { src: string; dest: string; }[] = [];
    //copy each file, retaining their folder structure relative to the rootDir
    await Promise.all(
        fileObjects.map(async (fileObject) => {
            let src = path.normalize(fileObject.src);
            let dest = fileObject.dest;
            let sourceIsDirectory = await isDirectory(src);

            let relativeSrc: string;
            //if we have an original src, and it contains the ** glob, use the relative position starting at **
            let globDoubleStarIndex = fileObject.srcOriginal ? fileObject.srcOriginal.indexOf('**') : -1;
            
            if (fileObject.srcOriginal && globDoubleStarIndex > -1 && sourceIsDirectory === false) {
                let pathToDoubleStar = fileObject.srcOriginal.substring(0, globDoubleStarIndex);
                relativeSrc = src.replace(pathToDoubleStar, '');
                dest = path.join(dest, relativeSrc);
            } else {
                relativeSrc = src.replace(rootDir, '');
            }

            //remove any leading path separator
            /* istanbul ignore next */
            relativeSrc = relativeSrc.indexOf(path.sep) !== 0 ? relativeSrc : relativeSrc.substring(1);

            //if item is a file
            if (sourceIsDirectory) {
                //source is a directory (which is only possible when glob resolves it as such)
                //do nothing, because we don't want to copy empty directories to output
            } else {
                let destinationPath: string;

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
async function copyToStaging(files: FilesType[], stagingPath: string, rootDir: string) {
    let fileObjects = await getFilePaths(files, stagingPath, rootDir);
    for (let fileObject of fileObjects) {
        //make sure the containing folder exists
        await fsExtra.ensureDir(path.dirname(fileObject.dest));

        //sometimes the copyfile action fails due to race conditions (normally to poorly constructed src;dest; objects with duplicate files in them
        //Just try a few fimes until it resolves itself. 

        for (let i = 0; i < 10; i++) {
            try {
                //copy the src item (file or directory full of files)
                await fsExtra.copy(fileObject.src, fileObject.dest);
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

/**
 * Determine if the given path is a directory
 * @param path 
 */
export async function isDirectory(pathToDirectoryOrFile: string) {
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
export async function pressHomeButton(host) {
    let homeClickUrl = `http://${host}:8060/keypress/Home`;
    // press the home button to return to the main screen
    return new Promise(function (resolve, reject) {
        request.post(homeClickUrl, function (err, response) {
            if (err) {
                return reject(err);
            }
            return resolve(response);
        });
    });
}

/**
 * Publish a pre-existing packaged zip file to a remote Roku.
 * @param options 
 */
export async function publish(options: RokuDeployOptions): Promise<{ message: string, results: any }> {
    options = getOptions(options);
    if (!options.host) {
        throw new Error('must specify the host for the Roku device');
    }
    let packageFolderPath = path.resolve(options.outDir);
    let packagePath = path.join(packageFolderPath, <string>options.outFile);
    let hostUrl = `http://${options.host}`;
    let packageUploadUrl = `${hostUrl}/plugin_install`;

    return Promise.all([]).then(function () {
        return pressHomeButton(options.host).then(function (response) {
            // upload the package to the Roku  
            return new Promise<any>(function (resolve, reject) {
                request.post({
                    url: packageUploadUrl,
                    formData: {
                        mysubmit: 'Replace',
                        archive: fs.createReadStream(packagePath)
                    }
                }, function (err, resp, body) {
                    if (err) {
                        return reject(err);
                    }
                    return resolve({ response: resp, body: body });
                }).auth(options.username, options.password, false);
            });
        }).then(function (results) {
            let error: any;
            if (options.failOnCompileError) {
                if (results && results.body && results.body.indexOf('Install Failure: Compilation Failed.') > -1) {
                    error = new Error('Compile error');
                    error.results = results;
                    return Q.reject(error);
                }
            }
            if (results && results.response && results.response.statusCode === 200) {
                if (results.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                    return { message: 'Identical to previous version -- not replacing', results: results };
                }
                return { message: 'Successful deploy', results: results };
            } else if (results && results.response) {
                if (results.response.statusCode === 401) {
                    error = new Error('Unauthorized. Please verify username and password for target Roku.');
                } else {
                    error = new Error('Error, statusCode other than 200: ' + results.response.statusCode);
                }
                error.results = results;
                return Q.reject(error);
            } else {
                error = new Error('Invalid response');
                error.results = results;
                return Q.reject(error);
            }
        });
    });
}

/**
 * Create a zip of the project, and then publish to the target Roku device
 * @param options 
 */
export async function deploy(options?: RokuDeployOptions) {
    options = getOptions(options);
    await createPackage(options);
    let result = await publish(options);
    return result;
}

/**
 * Get an options with all overridden vaues, and then defaults for missing values
 * @param options 
 */
export function getOptions(options: RokuDeployOptions = {}) {
    let fileOptions: RokuDeployOptions = {};
    //load a rokudeploy.json file if it exists
    if (fsExtra.existsSync('rokudeploy.json')) {
        let configFileText = fsExtra.readFileSync('rokudeploy.json').toString();
        fileOptions = JSON.parse(configFileText);
    }

    let defaultOptions = <RokuDeployOptions>{
        outDir: './out',
        outFile: 'roku-deploy.zip',
        retainStagingFolder: false,
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

/**
 * Given a path to a folder, zip up that folder and all of its contents
 * @param srcFolder 
 * @param zipFilePath 
 */
export function zipFolder(srcFolder: string, zipFilePath: string) {
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
        archive.on('warning', function (err) {
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

export interface RokuDeployOptions {
    /**
     * A full path to the folder where the zip package should be placed
     * @default "./out"
     */
    outDir?: string;
    /**
     * The name the zip file should be given. 
     * @default "roku-deploy.zip"
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
     * Set this to true prevent the staging folder from being deleted after creating the package
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
     * If true, the publish will fail on compile error
     */
    failOnCompileError?: boolean;
}

export type FilesType = (string | string[] | { src: string | string[]; dest?: string });