import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as Q from 'q';
import * as glob from 'glob';
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
    let files = [] as { src: string; dest: string }[];
    //standardize the files object
    for (let fileEntry of options.files) {
        let entry: any = fileEntry;
        if (typeof fileEntry === 'string') {
            entry = <any>{ src: fileEntry };
        }
        if (!entry.dest) {
            entry.dest = '';
        }
        files.push(entry);
    }

    //append the rootDir to every relative glob and string file entry
    for (let fileEntry of files as { src: string; dest: string }[]) {
        if (path.isAbsolute(fileEntry.src) === false) {
            fileEntry.src = path.join(options.rootDir, fileEntry.src);
        }
    }

    //create the staging folder if it doesn't already exist
    let stagingFolderPath = path.join(options.outDir, '.roku-deploy-staging');
    stagingFolderPath = path.resolve(stagingFolderPath);

    //clean the staging directory
    await fsExtra.remove(stagingFolderPath);

    //make sure the staging folder exists
    await fsExtra.ensureDir(stagingFolderPath);
    await copyToStaging(files, stagingFolderPath);
    return stagingFolderPath;
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
 * Will scan for a manifest file, and if found, will remove parent folders above manifest for zipped folder.
 * For example, if this is the files glob: ["AppCode/RokuProject/**\/*"], and manifest exists at AppCode/RokuProject/manifest, then
 * the output zip would omit the AppCode/RokuProject folder structure from the zip. 
 * @param options 
 */
export async function createPackage(options: RokuDeployOptions) {
    await prepublishToStaging(options);
    await zipPackage(options);
}

/**
 * Copy all of the files to the staging directory
 * @param fileGlobs 
 * @param stagingPath 
 */
async function copyToStaging(files: { src: string; dest: string }[], stagingPath: string) {
    stagingPath = path.normalize(stagingPath);

    //run glob lookups for every glob string provided
    let globPromises = <{ src: string; dest: string }[][]>[];
    files.forEach((file) => {
        let promise = Q.nfcall(glob, file.src).then((filePathArray) => {
            let result = <{ src: string; dest: string }[]>[];
            //if found more than one file, then the dest must be empty string or end in a slash
            if (filePathArray.length > 1 && !(file.dest === '' || file.dest.endsWith('/') || file.dest.endsWith('\\'))) {
                throw new Error(`Files entry matched multiple files, so dest must end in a slash to indicate that it is a folder ${JSON.stringify(file)}`);
            }
            for (let filePath of filePathArray) {
                result.push({
                    src: filePath,
                    dest: file.dest
                });
            }
            return result;
        });
        globPromises.push(promise);
    });

    //wait for all globs to finish
    let filePathObjects = await Promise.all(globPromises);

    let fileObjects = <{ src: string; dest: string }[]>[];
    //create a single array of all paths
    for (let filePathObject of filePathObjects) {
        fileObjects = fileObjects.concat(filePathObject);
    }

    //make all file paths absolute
    for (let fileObject of fileObjects) {
        fileObject.src = path.resolve(fileObject.src);
    }

    //find path for the manifest file
    let manifestPath: string | undefined;
    for (let fileObject of fileObjects) {
        if (path.basename(fileObject.src) === 'manifest') {
            manifestPath = fileObject.src;
        }
    }
    if (!manifestPath) {
        throw new Error('Unable to find manifest file');
    }

    //get the full path to the folder containing manifest
    let manifestParentPath = path.dirname(manifestPath);

    //copy each file, retaining their folder structure starting at the manifest location
    let copyPromises = fileObjects.map((fileObject: { src: string; dest: string }) => {
        let relativeSourcePath = fileObject.src.replace(manifestParentPath, '');
        let destinationPath: string;
        //if the dest ends in a slash (or is empty string), it's a folder and should use the relative source path
        if (fileObject.dest.endsWith('\\') || fileObject.dest.endsWith('/') || !fileObject.dest) {
            destinationPath = path.join(stagingPath, fileObject.dest, relativeSourcePath);
        } else {
            //dest is a relative path to a destination filename
            destinationPath = path.join(stagingPath, fileObject.dest);
        }

        let destinationFolderPath = path.dirname(destinationPath);
        return fsExtra.ensureDir(destinationFolderPath).then(() => {
            return Q.nfcall(fsExtra.copy, fileObject.src, destinationPath);
        });
    });
    await Promise.all(copyPromises);
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
     * The root path to the folder holding your project. This folder should include the manifest file.
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
    files?: (string | { src: string; dest: string; })[];
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
