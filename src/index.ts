import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as Q from 'q';
import * as zipFolder from 'zip-folder';
import * as glob from 'glob';
import * as request from 'request';
import * as fs from 'fs';

/**
 * Create a zip folder containing all of the specified roku project files.
 * Will scan for a manifest file, and if found, will remove parent folders above manifest for zipped folder.
 * For example, if this is the files glob: ["AppCode/RokuProject/**\/*"], and manifest exists at AppCode/RokuProject/manifest, then
 * the output zip would omit the AppCode/RokuProject folder structure from the zip. 
 * @param options 
 */
export async function createPackage(options: RokuDeployOptions) {
    options = getOptions(options);

    //cast some of the options as not null so we don't have to cast them below
    options.rootDir = <string>options.rootDir;
    options.files = <string[]>options.files;
    //append the rootDir to every glob
    for (let i = 0; i < options.files.length; i++) {
        options.files[i] = path.join(options.rootDir, options.files[i]);
    }

    options.outDir = <string>options.outDir;
    options.outFile = <string>options.outFile;

    //create the staging folder if it doesn't already exist
    let stagingFolderPath = path.join(".", ".roku-deploy-staging");
    stagingFolderPath = path.resolve(stagingFolderPath);

    //clean the staging directory
    await fsExtra.remove(stagingFolderPath);

    //make sure the staging folder exists
    await fsExtra.ensureDir(stagingFolderPath);
    await copyToStaging(options.files, stagingFolderPath);

    let outFolderPath = path.resolve(options.outDir);
    //make sure the output folder exists
    await fsExtra.ensureDir(outFolderPath);
    let outFilePath = path.join(outFolderPath, options.outFile);

    //create a zip of the staging folder
    await Q.nfcall(zipFolder, stagingFolderPath, outFilePath);

    //remove the staging folder path
    await fsExtra.remove(stagingFolderPath);
}

/**
 * Copy all of the files to the staging directory
 * @param fileGlobs 
 * @param stagingPath 
 */
async function copyToStaging(fileGlobs: string[], stagingPath: string) {
    stagingPath = path.normalize(stagingPath);
    let filePaths: string[] = [];

    //run glob lookups for every glob string provided
    let globPromises: Promise<string[]>[] = [];
    for (let fileGlob of fileGlobs) {
        globPromises.push(
            Q.nfcall(glob, fileGlob)
        );
    }

    //wait for all globs to finish
    let filePathArrays = await Promise.all(globPromises);

    //create a single array of all paths
    for (let filePathArray of filePathArrays) {
        filePaths = filePaths.concat(filePathArray);
    }

    //make all file paths absolute
    filePaths = filePaths.map((filePath) => {
        return path.resolve(filePath);
    });

    //remove duplicate entries
    filePaths = filePaths.filter(function (item, index, inputArray) {
        return inputArray.indexOf(item) == index;
    });

    //find path for the manifest file
    let manifestPath: string | undefined;
    for (let filePath of filePaths) {
        if (path.basename(filePath) === 'manifest') {
            manifestPath = filePath;
        }
    }
    if (!manifestPath) {
        throw new Error('Unable to find manifest file');
    }

    //get the full path to the folder containing manifest
    let manifestParentPath = path.dirname(manifestPath);

    //copy each file, retaining their folder structure starting at the manifest location
    let copyPromises = filePaths.map((sourcePath: string) => {
        let relativeSourcePath = sourcePath.replace(manifestParentPath, '');
        let destinationPath = path.join(stagingPath, relativeSourcePath);
        let destinationFolderPath = path.dirname(destinationPath);
        return fsExtra.ensureDir(destinationFolderPath).then(() => {
            return Q.nfcall(fsExtra.copy, sourcePath, destinationPath);
        });
    });
    await Promise.all(copyPromises);
}

export async function publish(options: RokuDeployOptions): Promise<{ message: string, results: any }> {
    options = getOptions(options);
    if (!options.host) {
        throw new Error('must specify the host for the Roku device');
    }
    let packageFolderPath = path.resolve(options.outDir);
    let packagePath = path.join(packageFolderPath, <string>options.outFile);
    let hostUrl = `http://${options.host}`;
    let homeClickUrl = `${hostUrl}:8060/keypress/Home`;
    let packageUploadUrl = `${hostUrl}/plugin_install`;

    return Promise.all([]).then(function () {
        // press the home button to return to the main screen
        return new Promise(function (resolve, reject) {
            request.post(homeClickUrl, function (err, response) {
                if (err) {
                    return reject(err)
                }
                return resolve(response)
            })
        }).then(function (response) {
            // upload the package to the Roku  
            return new Promise<any>(function (resolve, reject) {
                request.post({
                    url: packageUploadUrl,
                    formData: {
                        mysubmit: 'Replace',
                        archive: fs.createReadStream(packagePath)
                    }
                }, function (err, response, body) {
                    if (err) {
                        return reject(err)
                    }
                    return resolve({ response: response, body: body })
                }).auth(options.username, options.password, false)
            })
        }).then(function (results) {
            if (results && results.response && results.response.statusCode === 200) {
                if (results.body.indexOf('Identical to previous version -- not replacing.') != -1) {
                    return { message: 'Identical to previous version -- not replacing', results: results }
                }
                return { message: 'Successful deploy', results: results }
            } else if (results && results.response) {
                let error: any;
                if (results.response.statusCode === 401) {
                    error = new Error('Unauthorized. Please verify username and password for target Roku.');
                } else {
                    error = new Error('Error, statusCode other than 200: ' + results.response.statusCode);
                }
                error.response = results.response;
                return Q.reject(error);
            } else {
                return Q.reject({ message: 'Invalid response', results: results });
            }
        })
    })
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
        rootDir: './',
        files: [
            "source/**/*.*",
            "components/**/*.*",
            "images/**/*.*",
            "manifest"
        ],
        username: 'rokudev'
    };

    //override the defaults with any found or provided options
    let finalOptions = Object.assign({}, defaultOptions, fileOptions, options);

    return finalOptions;
}

export interface RokuDeployOptions {
    /**
     * A full path to the folder where the zip package sould be placed
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
    /**
     * An array of file paths or globs
     * @default [
            "source/**\/*.*",
            "components/**\/*.*",
            "images/**\/*.*",
            "manifest"
        ],
     */
    files?: string[];
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
     * The username for the roku box. This will almost always be 'rokudev', but allow to be passed in
     * just in case roku adds support for custom usernames in the future
     * @default "rokudev"
     */
    username?: string;
    /**
     * The password for logging in to the developer portal on the target Roku device
     * @required
     */
    password?: string;
}
