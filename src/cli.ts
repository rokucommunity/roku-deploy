#!/usr/bin/env node
import * as yargs from 'yargs';
import { rokuDeploy } from './index';
import { ExecCommand } from './commands/ExecCommand';
import { TextCommand } from './commands/TextCommand';
import { PrepublishCommand } from './commands/PrepublishCommand';
import { ZipPackageCommand } from './commands/ZipPackageCommand';
import { PublishCommand } from './commands/PublishCommand';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { CreateSignedPackageCommand } from './commands/CreateSignedPackageCommand';
import { DeleteDevChannelCommand } from './commands/DeleteDevChannelCommand';
import { TakeScreenshotCommand } from './commands/TakeScreenshotCommand';
import { GetOutputZipFilePathCommand } from './commands/GetOutputZipFilePathCommand';
import { GetOutputPkgFilePathCommand } from './commands/GetOutputPkgFilePathCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';
import { ZipCommand } from './commands/ZipCommand';

void yargs

    .command('bundle', 'execute build actions for bundling app', (builder) => {
        return builder
            .option('configPath', { type: 'string', description: 'The path to the config file', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(
            'stage|zip',
            args.configPath
        ).run();
    })

    .command('deploy', 'execute build actions for deploying app', (builder) => {
        return builder
            .option('configPath', { type: 'string', description: 'The path to the config file', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(
            'stage|zip|delete|close|sideload',
            args.configPath
        ).run();
    })

    .command('package', 'execute build actions for packaging app', (builder) => {
        return builder
            .option('configPath', { type: 'string', description: 'The path to the config file', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(
            'close|rekey|stage|zip|delete|close|sideload|squash|sign',
            args.configPath
        ).run();
    })

    .command('exec', 'larger command for handling a series of smaller commands', (builder) => {
        return builder
            .option('actions', { type: 'string', description: 'The actions to be executed, separated by |', demandOption: true })
            .option('configPath', { type: 'string', description: 'The path to the config file', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(args.actions, args.configPath).run();
    })

    .command(['sendText', 'text'], 'Send text command', (builder) => {
        return builder
            .option('text', { type: 'string', description: 'The text to send', demandOption: true });
    }, (args: any) => {
        return new TextCommand().run(args); //TODO: do this through exec command to get default args like host and port? or add those to here and go through separate command for better testing
    })

    .command('keypress', 'send keypress command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true });
    }, async (args: any) => {
        await rokuDeploy.keyPress(args.text); //TODO: Go through exec command, separate command, or use key event?
    })

    .command('keyup', 'send keyup command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true });
    }, async (args: any) => {
        await rokuDeploy.keyUp(args.text); //TODO: Go through exec command, separate command, or use key event?
    })

    .command('keydown', 'send keydown command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true });
    }, async (args: any) => {
        await rokuDeploy.keyDown(args.text); //TODO: Go through exec command, separate command, or use key event?
    })

    .command(['stage', 'prepublishToStaging'], 'Copies all of the referenced files to the staging folder', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false });
    }, (args: any) => {
        return new PrepublishCommand().run(args);
    })

    .command(['zip', 'zipPackage'], 'Given an already-populated staging folder, create a zip archive of it and copy it to the output folder', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false });
    }, (args: any) => {
        return new ZipPackageCommand().run(args);
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

    .command(['squash', 'convertToSquashfs'], 'Convert a pre-existing packaged zip file to a squashfs file', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new ConvertToSquashfsCommand().run(args);
    })

    .command(['rekey', 'rekeyDevice'], 'Rekey a device', (builder) => {
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

    .command('createSignedPackage', 'Sign a package', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false });
    }, (args: any) => {
        return new CreateSignedPackageCommand().run(args);
    })

    .command('deploy', 'Deploy a pre-existing packaged zip file to a remote Roku', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The root directory', demandOption: false });
    }, (args: any) => {
        return new DeployCommand().run(args);
    })

    .command(['deleteDevChannel', 'deleteInstalledChannel', 'rmdev', 'delete'], 'Delete an installed channel', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new DeleteInstalledChannelCommand().run(args);
    })

    .command(['screenshot', 'captureScreenshot'], 'Take a screenshot', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new TakeScreenshotCommand().run(args);//TODO: rename
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

    .command(['getDeviceInfo', 'deviceinfo'], 'Get the `device-info` response from a Roku device', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false });
    }, (args: any) => {
        return new GetDeviceInfoCommand().run(args);
    })

    .command(['getDevId', 'devid'], 'Get Dev ID', (builder) => {
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
