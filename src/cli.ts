#!/usr/bin/env node
import * as yargs from 'yargs';
import * as path from 'path';
import { SendTextCommand } from './commands/SendTextCommand';
import { StageCommand } from './commands/StageCommand';
import { SideloadCommand } from './commands/SideloadCommand';
import { ConvertToSquashfsCommand } from './commands/ConvertToSquashfsCommand';
import { RekeyDeviceCommand } from './commands/RekeyDeviceCommand';
import { CreateSignedPackageCommand } from './commands/CreateSignedPackageCommand';
import { DeleteDevChannelCommand } from './commands/DeleteDevChannelCommand';
import { CaptureScreenshotCommand } from './commands/CaptureScreenshotCommand';
import { GetDeviceInfoCommand } from './commands/GetDeviceInfoCommand';
import { GetDevIdCommand } from './commands/GetDevIdCommand';
import { ZipCommand } from './commands/ZipCommand';
import { KeyPressCommand } from './commands/KeyPressCommand';
import { KeyUpCommand } from './commands/KeyUpCommand';
import { KeyDownCommand } from './commands/KeyDownCommand';
import { RemoteControlCommand } from './commands/RemoteControlCommand';

void yargs

    .command('sideload', 'Sideload a pre-existing packaged zip file to a remote Roku', (builder) => {
        return builder
            .option('zip', { type: 'string', description: 'The file to be sideloaded, relative to cwd.', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The root folder to be sideloaded, instead of a zip file, relative to cwd.', demandOption: false })
            .option('outZip', { type: 'string', description: 'The output path to the zip file.', demandOption: false })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('ecpPort', { type: 'number', description: 'The port to use for ECP commands like remote keypresses', demandOption: false })
            .option('packagePort', { type: 'number', description: 'The port to use for sending a packaging to the device', demandOption: false })
            .option('noclose', { type: 'boolean', description: 'Should the command not close the channel before sideloading', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false })
            .option('remoteDebug', { type: 'boolean', description: 'Should the command be run in remote debug mode', demandOption: false })
            .option('remoteDebugConnectEarly', { type: 'boolean', description: 'Should the command connect to the debugger early', demandOption: false })
            .option('failOnCompileError', { type: 'boolean', description: 'Should the command fail if there is a compile error', demandOption: false })
            .option('deleteDevChannel', { type: 'boolean', description: 'Should the dev channel be deleted', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new SideloadCommand().run(args);
    })

    .command('package', 'Create a signed package from an existing sideloaded dev channel', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('appTitle', { type: 'string', description: 'The title of the app to be signed', demandOption: false })
            .option('appVersion', { type: 'string', description: 'The version of the app to be signed', demandOption: false })
            .option('manifestPath', { type: 'string', description: 'The path to the manifest file, relative to cwd', demandOption: false })
            .option('out', { type: 'string', description: 'The location where the signed package will be saved, relative to cwd', demandOption: false, defaultDescription: './out/roku-deploy.pkg' })
            .option('devId', { type: 'string', description: 'The dev ID', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        if (args.out) {
            if (!args.out.endsWith('.pkg')) {
                throw new Error('Out must end with a .pkg');
            }
            args.out = path.resolve(args.cwd, args.out);
            args.outDir = path.dirname(args.out);
            args.outFile = path.basename(args.out);
        }
        return new CreateSignedPackageCommand().run(args);
    })

    .command('keyPress', 'send keypress command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('ecpPort', { type: 'number', description: 'The port to use for ECP commands like remote keypresses', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        if (args.ecpPort) {
            args.remotePort = args.ecpPort;
        }
        return new KeyPressCommand().run(args);
    })

    .command('keyUp', 'send keyup command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('ecpPort', { type: 'number', description: 'The port to use for ECP commands like remote keypresses', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        if (args.ecpPort) {
            args.remotePort = args.ecpPort;
        }
        return new KeyUpCommand().run(args);
    })

    .command('keyDown', 'send keydown command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('ecpPort', { type: 'number', description: 'The port to use for ECP commands like remote keypresses', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        if (args.ecpPort) {
            args.remotePort = args.ecpPort;
        }
        return new KeyDownCommand().run(args);
    })

    .command('sendText', 'Send text command', (builder) => {
        return builder
            .option('text', { type: 'string', description: 'The text to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('ecpPort', { type: 'number', description: 'The port to use for ECP commands like remote keypresses', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        if (args.ecpPort) {
            args.remotePort = args.ecpPort;
        }
        return new SendTextCommand().run(args);
    })

    .command('remote-control', 'Provides a way to send a series of ECP key events similar to how Roku Remote Tool works but from the command line', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('ecpPort', { type: 'number', description: 'The port to use for ECP commands like remote keypresses', demandOption: false });
    }, (args: any) => {
        if (args.ecpPort) {
            args.remotePort = args.ecpPort;
        }
        return new RemoteControlCommand().run(args);
    })

    .command('stage', 'Copies all of the referenced files to the staging folder', (builder) => {
        return builder
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
            .option('files', { type: 'array', description: 'An array of source file paths indicating where the source files are', demandOption: false })
            .option('out', { type: 'string', description: 'The selected staging folder where all files will be copied to', demandOption: false });
    }, (args: any) => {
        return new StageCommand().run(args);
    })

    .command('squash', 'Convert a pre-existing packaged zip file to a squashfs file', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new ConvertToSquashfsCommand().run(args);
    })

    .command('rekey', 'Rekey a device', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('pkg', { type: 'string', description: 'The path to thesigned package to be used for rekeying, relative to cwd', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('devId', { type: 'string', description: 'The dev ID', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        args.rekeySignedPackage = path.resolve(args.cwd, args.pkg);
        return new RekeyDeviceCommand().run(args);
    })

    .command('deleteDevChannel', 'Delete an installed channel', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false });
    }, (args: any) => {
        return new DeleteDevChannelCommand().run(args);
    })

    .command('screenshot', 'Take a screenshot', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('out', { type: 'string', description: 'The location where the screenshot will be saved relative to cwd', demandOption: false, defaultDescription: './out/roku-deploy.jpg' })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        if (args.out) {
            args.out = path.resolve(args.cwd, args.out);
            args.screenshotDir = path.dirname(args.out);
            args.screenshotFile = path.basename(args.out);
        }
        return new CaptureScreenshotCommand().run(args);
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

    .command('zip', 'Given a path to a folder, zip up that folder and all of its contents', (builder) => {
        return builder
            .option('dir', { type: 'string', description: 'The folder to be zipped', demandOption: false })
            .option('out', { type: 'string', description: 'the path to the zip file that will be created, relative to cwd', demandOption: false, alias: 'outZip' })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        if (args.out) {
            args.out = path.resolve(args.cwd, args.out);
            args.outDir = path.dirname(args.out);
            args.outFile = path.basename(args.out);
        }
        if (args.dir) {
            args.stagingDir = path.resolve(args.cwd, args.dir);
        }
        return new ZipCommand().run(args);
    })

    .argv;
