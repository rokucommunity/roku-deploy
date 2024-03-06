#!/usr/bin/env node
import * as yargs from 'yargs';
import { ExecCommand } from './commands/ExecCommand';
import { SendTextCommand } from './commands/SendTextCommand';
import { PrepublishCommand } from './commands/PrepublishCommand';
import { ZipPackageCommand } from './commands/ZipPackageCommand';
import { PublishCommand } from './commands/PublishCommand';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { CreateSignedPackageCommand } from './commands/CreateSignedPackageCommand';
import { DeleteDevChannelCommand } from './commands/DeleteDevChannelCommand';
import { TakeScreenshotCommand } from './commands/TakeScreenshotCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';
import { ZipCommand } from './commands/ZipCommand';
import { KeyPressCommand } from './commands/KeyPressCommand';
import { KeyUpCommand } from './commands/KeyUpCommand';
import { KeyDownCommand } from './commands/KeyDownCommand';
import type { RokuDeploy } from './RokuDeploy';

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

    .command('keypress', 'send keypress command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remoteport', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new KeyPressCommand().run(args);
    })

    .command('keyup', 'send keyup command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remoteport', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new KeyUpCommand().run(args);
    })

    .command('keydown', 'send keydown command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remoteport', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new KeyDownCommand().run(args);
    })

    .command(['sendText', 'text'], 'Send text command', (builder) => {
        return builder
            .option('text', { type: 'string', description: 'The text to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remoteport', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new SendTextCommand().run(args); //TODO: Add default options
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

    .command(['deleteDevChannel', 'deleteInstalledChannel', 'rmdev', 'delete'], 'Delete an installed channel', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new DeleteDevChannelCommand().run(args);
    })

    .command(['screenshot', 'captureScreenshot'], 'Take a screenshot', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new TakeScreenshotCommand().run(args);
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

    .command('zip', 'Given a path to a folder, zip up that folder and all of its contents', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The folder that should be zipped', demandOption: false })
            .option('outDir', { type: 'string', description: 'The path to the zip that will be created. Must be .zip file name', demandOption: false });
    }, (args: any) => {
        console.log('args', args);
        return new ZipCommand().run(args);
    })

    .argv;
