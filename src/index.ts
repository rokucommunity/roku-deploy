import * as copy from 'copy';
import * as copyfiles from 'copyfiles';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as Q from 'q';
import * as zipFolder from 'zip-folder';
import * as rimraf from 'rimraf';
import * as glob from 'glob';

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

    console.log(JSON.stringify(options.files));

    //create the staging folder if it doesn't already exist
    let stagingFolderPath = path.join(".", ".roku-deploy-staging");
    stagingFolderPath = path.resolve(stagingFolderPath);

    //clean the staging directory
    await Q.nfcall(rimraf, stagingFolderPath);

    //make sure the staging folder exists
    await fsExtra.ensureDir(stagingFolderPath);

    //copy all of the files to the staging folder
    await Q.nfcall(copy, options.files, stagingFolderPath);

    //move all of the files up to the root of the staging folder
    let manifestPath = (await Q.nfcall(glob, path.join(stagingFolderPath, '**/manifest')))[0];
    let upCount = getUpDirCount(stagingFolderPath, manifestPath);
    if (upCount > 0) {
        //copy the files from the manifest's path to the root of the staging directory
        await Q.nfcall(copyfiles, [path.join(stagingFolderPath, '**/*'), stagingFolderPath], upCount);
    }
    let outFolderPath = path.resolve(options.outDir);
    //make sure the output folder exists
    await fsExtra.ensureDir(outFolderPath);
    let outFilePath = path.join(outFolderPath, options.outFile);

    //create a zip of the staging folder
    await Q.nfcall(zipFolder, stagingFolderPath, outFilePath);

    //remove the staging folder path
    await Q.nfcall(rimraf, stagingFolderPath);
}

/**
 * Given a root path and a full path, determine the number of directory traversals
 * upward it would take to reach the root path
 * @param rootPath
 * @param fullPath 
 */
export function getUpDirCount(rootPath: string, fullPath: string) {
    //normalize the paths
    rootPath = path.normalize(rootPath);
    fullPath = path.normalize(fullPath);
    let count = -1;
    let iterations = 0;
    let lastPath: string;

    let currentPath = fullPath;
    //the last item in the path is the file
    for (let i = 0; i < 5000; i++) {
        lastPath = currentPath;
        currentPath = path.dirname(currentPath);
        count++;
        if (currentPath === rootPath) {
            return count;
        }
        if (lastPath === currentPath) {
            throw new Error(`Unable to determine upDirCount for rootPath '${rootPath}' and fullPath '${fullPath}'`);
        }
    }
    //fell out of that very long loop. If we haven't solved the path issue by now, we never will
    throw new Error(`Prevented infinite while looking for upDirCount for rootPath: ${rootPath}`);
}

export async function publish(options: RokuDeployOptions) {
    options = getOptions(options);
    let outFolderPath = path.resolve(options.outDir);
    let outFilePath = path.join(outFolderPath, <string>options.outFile);

    // await rokuDeploy({
    //     ipaddress: options.host,
    //     password: options.password,
    //     packagePath: outFilePath
    // });
}

/**
 * Create a zip of the project, and then publish to the target Roku device
 * @param options 
 */
export default async function deploy(options: RokuDeployOptions) {
    options = getOptions(options);
    await createPackage(options);
    await publish(options);
}

/**
 * Get an options with all overridden vaues, and then defaults for missing values
 * @param options 
 */
export function getOptions(options: RokuDeployOptions = {}) {
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
        ]
    };
    for (let key in options) {
        defaultOptions[key] = options[key];
    }
    return defaultOptions;
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
     */
    rootDir?: string;
    /**
     * An array of file paths or globs
     */
    files?: string[];
    /**
     * Set this to true prevent the staging folder from being deleted after creating the package
     */
    retainStagingFolder?: boolean;
    /**
     * The IP address or hostname of the target Roku device
     * @example "192.168.1.21" 
     */
    host?: string;
    /**
     * The password for logging in to the developer portal on the target Roku device
     */
    password?: string;
}