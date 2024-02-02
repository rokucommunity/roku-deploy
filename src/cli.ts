#!/usr/bin/env node
import * as yargs from 'yargs';
import { PrepublishCommand } from './commands/PrepublishCommand';
import { ZipPackageCommand } from './commands/ZipPackageCommand';
import { CreatePackageCommand } from './commands/CreatePackageCommand';
import { PublishCommand } from './commands/PublishCommand';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { SignExistingPackageCommand } from './commands/SignExistingPackageCommand';
import { RetrieveSignedPackageCommand } from './commands/RetrieveSignedPackageCommand';
import { DeployCommand } from './commands/DeployCommand';
import { DeleteInstalledChannelCommand } from './commands/DeleteInstalledChannelCommand';
import { TakeScreenshotCommand } from './commands/TakeScreenshotCommand';
import { GetOutputZipFilePathCommand } from './commands/GetOutputZipFilePathCommand';
import { GetOutputPkgFilePathCommand } from './commands/GetOutputPkgFilePathCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';
import { ZipFolderCommand } from './commands/ZipFolderCommand';

void yargs

    //not exposed
    // .command('stage')
    // .command('zip')
    // .command('closeChannel')
    // .command('sideload')
    // .command('convertToSquashfs') //alias: squash
    // .command('rekeyDevice') //alias: rekey
    // .command('createSignedPackage') //alias: sign
    // .command('deleteDevChannel') // alias: rmdev deldev

    .command('keypress')
    .command('keyup')
    .command('keydown')
    .command('text') //alias: sendText
    .command('screenshot') // alias: captureScreenshot
    .command('deviceinfo') // alias: getDeviceInfo
    .command('devid') // alias: getDevId

    //bundle
    .command('stage|zip')

    //deploy
    .command('stage|zip|delete|close|sideload')

    //package
    .command('close|rekey|stage|zip|delete|close|sideload|squash|sign')

    //exec
    .command('magic')















    .command('stage', 'Copies all of the referenced files to the staging folder', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false });
    }, (args: any) => {
        return new PrepublishCommand().run(args);
    })

    .command('zip', 'Given an already-populated staging folder, create a zip archive of it and copy it to the output folder', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false });
    }, (args: any) => {
        return new ZipPackageCommand().run(args);
    })



    .command('createPackage', 'Create a zip folder containing all of the specified roku project files', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false });
    }, (args: any) => {
        return new CreatePackageCommand().run(args);
    })

    .command('publish', 'Publish a pre-existing packaged zip file to a remote Roku', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false })
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false });
    }, (args: any) => {
        return new PublishCommand().run(args);
    })

    .command('convertToSquashfs', 'Convert a pre-existing packaged zip file to a squashfs file', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new ConvertToSquashfsCommand().run(args);
    })

    .command('rekeyDevice', 'Rekey a device', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('rekeySignedPackage', { type: 'string', description: 'The signed package to be used for rekeying', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The root directory', demandOption: false })
            .option('devId', { type: 'string', description: 'The dev ID', demandOption: false });
    }, (args: any) => {
        return new RekeyDeviceCommand().run(args);
    })

    .command('signExistingPackage', 'Sign a package', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false });
    }, (args: any) => {
        return new SignExistingPackageCommand().run(args);
    })

    .command('retrieveSignedPackage', 'Retrieve a signed package', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false });
    }, (args: any) => {
        return new RetrieveSignedPackageCommand().run(args);
    })

    .command('deploy', 'Deploy a pre-existing packaged zip file to a remote Roku', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The root directory', demandOption: false });
    }, (args: any) => {
        return new DeployCommand().run(args);
    })

    .command('deleteInstalledChannel', 'Delete an installed channel', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new DeleteInstalledChannelCommand().run(args);
    })

    .command('takeScreenshot', 'Take a screenshot', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new TakeScreenshotCommand().run(args);
    })

    .command('getOutputZipFilePath', 'Centralizes getting output zip file path based on passed in options', (builder) => {
        return builder
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false });
        return builder;
    }, (args: any) => {
        return new GetOutputZipFilePathCommand().run(args);
    })

    .command('getOutputPkgFilePath', 'Centralizes getting output pkg file path based on passed in options', (builder) => {
        return builder
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false });
    }, (args: any) => {
        return new GetOutputPkgFilePathCommand().run(args);
    })

    .command('getDeviceInfo', 'Get the `device-info` response from a Roku device', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false });
    }, (args: any) => {
        return new GetDeviceInfoCommand().run(args);
    })

    .command('getDevId', 'Get Dev ID', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false });
    }, (args: any) => {
        return new GetDevIdCommand().run(args);
    })

    .command('zipFolder', 'Given a path to a folder, zip up that folder and all of its contents', (builder) => {
        return builder
            .option('srcFolder', { type: 'string', description: 'The folder that should be zipped', demandOption: false })
            .option('zipFilePath', { type: 'string', description: 'The path to the zip that will be created. Must be .zip file name', demandOption: false });
    }, (args: any) => {
        console.log('args', args);
        return new ZipFolderCommand().run(args);
    })

    .argv;
