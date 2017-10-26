import * as copy from 'copy';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { Q } from 'q';

var rokuDeploy = require('./deploy');
var zipFolder = require('zip-folder');
var rimraf = require('rimraf');

/**
 * Create a zip folder containing all of the specified roku project files
 * @param options 
 */
export async function createPackage(options: RokuDeployOptions) {
    options = getOptions(options);
    //create the staging folder if it doesn't already exist
    let stagingFolderPath = path.join(".", ".roku-deploy-staging");
    stagingFolderPath = path.resolve(stagingFolderPath);

    //make sure the staging folder exists
    await fsExtra.ensureDir(stagingFolderPath);

    //clean the staging directory
    await Q.nfcall(rimraf, stagingFolderPath);

    //copy all of the files flagged in the config
    await Q.nfcall(copy, options.files, stagingFolderPath);

    let outFolderPath = path.resolve(options.outDir);
    //make sure the output folder exists
    await fsExtra.ensureDir(outFolderPath);
    let outFilePath = path.join(outFolderPath, options.outFile);

    //create a zip of the staging folder
    await Q.nfcall(zipFolder, stagingFolderPath, outFilePath);

}

export async function publish(options: RokuDeployOptions) {
    options = getOptions(options);
    let outFolderPath = path.resolve(options.outDir);
    let outFilePath = path.join(outFolderPath, options.outFile);

    await rokuDeploy({
        ipaddress: options.host,
        password: options.password,
        packagePath: outFilePath
    });
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


function getOptions(options: RokuDeployOptions) {
    let defaultOptions = <RokuDeployOptions>{
        outDir: './out',
        outFile: 'roku-deploy.zip',
        retainStagingFolder: false,
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

interface RokuDeployOptions {
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
    host: string;
    /**
     * The password for logging in to the developer portal on the target Roku device
     */
    password: string;
}