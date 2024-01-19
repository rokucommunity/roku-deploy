#!/usr/bin/env node
import * as yargs from 'yargs';
import { stagingDir } from './testUtils.spec';
import { prepublishToStaging, zipPackage, createPackage, publish, getOutputZipFilePath, getOutputPkgFilePath, getDeviceInfo, getDevId, zipFolder } from './index';
const outDir = './out';

new Promise((resolve, reject) => {
    // TODO: is this necessary?vv
    // eslint-disable-next-line
    yargs
        .command('prepublishToStaging', 'Copies all of the referenced files to the staging folder', (builder) => {
            return builder
                .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: true })
                .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: true });
        }, (args: any) => {
            console.log('prepublishToStaging');
            prepublishToStaging({
                files: [
                    'manifest'
                ],
                stagingDir: args.stagingDir,
                rootDir: args.rootDir
            }).then(() => {
                console.error('SUCCESS');
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
            // TODO: Should we have defaults for these^^
            // TODO: This doesn't work
        })

        .command('zipPackage', 'Given an already-populated staging folder, create a zip archive of it and copy it to the output folder', (builder) => {
            return builder
                .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
                .option('outDir', { type: 'string', description: 'The output directory', default: outDir, demandOption: false });
        }, (args: any) => {
            console.log('zipPackage');
            zipPackage({
                stagingDir: stagingDir,
                outDir: args.outDir
            }).then(() => {
                console.error('SUCCESS');
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
            // TODO: Missing manifest file
        })

        .command('createPackage', 'Create a zip folder containing all of the specified roku project files', (builder) => {
            return builder
                .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
                .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
                .option('outDir', { type: 'string', description: 'The output directory', default: outDir, demandOption: false });
        }, (args: any) => {
            console.log('createPackage');
            createPackage({
                files: [
                    'manifest'
                ],
                stagingDir: '.tmp/dist',
                outDir: args.outDir,
                rootDir: './src'
            }).then(() => {
                console.error('SUCCESS');
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
            // TODO: Missing manifest file
        })

        .command('publish', 'Publish a pre-existing packaged zip file to a remote Roku', (builder) => {
            return builder
                .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: true })
                .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: true })
                .option('outDir', { type: 'string', description: 'The output directory', default: outDir, demandOption: false })
                .option('outFile', { type: 'string', description: 'The output file', default: 'roku-deploy', demandOption: false });
        }, (args: any) => {
            console.log('publish');
            publish({
                host: args.host,
                password: args.password,
                outDir: args.outDir,
                outFile: args.outFile
            }).then(() => {
                console.error('SUCCESS');
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
            // TODO: Times out
        })

    // TODO:
    // convertToSquashfs
    // rekeyDevice
    // signExistingPackage
    // retrieveSignedPackage
    // deploy
    // deleteInstalledChannel
    // takeScreenshot
    // deployAndSignPackage - TODO: does the same thing as deploy but also signs package...is it necessary?

        .command('getOutputZipFilePath', 'Centralizes getting output zip file path based on passed in options', (builder) => {
            // EXAMPLE: npx roku-deploy getOutputZipFilePath
            return builder;
        }, (args: any) => {
            console.log('getOutputZipFilePath');
            console.log(getOutputZipFilePath({}));
        })

        .command('getOutputPkgFilePath', 'Centralizes getting output pkg file path based on passed in options', (builder) => {
            // EXAMPLE: npx roku-deploy getOutputPkgFilePath
            return builder;
        }, (args: any) => {
            console.log('getOutputPkgFilePath');
            let result = getOutputPkgFilePath({});
            console.log(result);
        })

        .command('getDeviceInfo', 'Get the `device-info` response from a Roku device', (builder) => {
            return builder
                .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: true });
        }, (args: any) => {
            console.log('getDeviceInfo');
            let result = getDeviceInfo({
                host: args.host
            }).then(() => {
                console.error('SUCCESS', result);
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
            // TODO: returns pending promise?
        })

        .command('getDevId', 'Get Dev ID', (builder) => {
            return builder
                .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: true });
        }, (args: any) => {
            console.log('getDevId');
            let result = getDevId({
                host: args.host
            }).then(() => {
                console.error('SUCCESS', result);
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
            // TODO: returns pending promise?
        })

        .command('zipFolder', 'Given a path to a folder, zip up that folder and all of its contents', (builder) => {
            // EXAMPLE: npx roku-deploy zipFolder --srcFolder ./src --zipFilePath ./output.zip
            return builder
                .option('srcFolder', { type: 'string', description: 'The folder that should be zipped', demandOption: true })
                .option('zipFilePath', { type: 'string', description: 'The path to the zip that will be created. Must be .zip file name', demandOption: true });
        }, (args: any) => {
            console.log('zipFolder');
            zipFolder(
                args.srcFolder,
                args.zipFilePath
            ).then(() => {
                console.error('SUCCESS');
            }, (error) => {
                console.error('ERROR', error, '\n', args);
            });
        })

        .argv;
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
