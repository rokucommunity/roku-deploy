#!/usr/bin/env node
import * as yargs from 'yargs';
import * as path from 'path';
import { ExecCommand } from './commands/ExecCommand';
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

    .command('bundle', 'execute build actions for bundling app', (builder) => {
        return builder
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false })
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(
            'stage|zip',
            args
        ).run();
    })

    .command('deploy', 'execute build actions for deploying app', (builder) => {
        return builder
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
            .option('outDir', { type: 'number', description: 'The output directory', demandOption: false })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false })
            .option('remoteDebug', { type: 'boolean', description: 'Should the command be run in remote debug mode', demandOption: false })
            .option('remoteDebugConnectEarly', { type: 'boolean', description: 'Should the command connect to the debugger early', demandOption: false })
            .option('failOnCompileError', { type: 'boolean', description: 'Should the command fail if there is a compile error', demandOption: false })
            .option('retainDeploymentArchive', { type: 'boolean', description: 'Should the deployment archive be retained', demandOption: false })
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false })
            .option('deleteDevChannel', { type: 'boolean', description: 'Should the dev channel be deleted', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(
            'stage|zip|close|sideload',
            args
        ).run();
    })

    .command('package', 'execute build actions for packaging app', (builder) => {
        return builder
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
            .option('outDir', { type: 'number', description: 'The output directory', demandOption: false })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false })
            .option('remoteDebug', { type: 'boolean', description: 'Should the command be run in remote debug mode', demandOption: false })
            .option('remoteDebugConnectEarly', { type: 'boolean', description: 'Should the command connect to the debugger early', demandOption: false })
            .option('failOnCompileError', { type: 'boolean', description: 'Should the command fail if there is a compile error', demandOption: false })
            .option('retainDeploymentArchive', { type: 'boolean', description: 'Should the deployment archive be retained', demandOption: false })
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false })
            .option('deleteDevChannel', { type: 'boolean', description: 'Should the dev channel be deleted', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new ExecCommand(
            'close|rekey|stage|zip|close|sideload|squash|sign',
            args
        ).run();
    })

    .command('exec', 'larger command for handling a series of smaller commands', (builder) => {
        return builder
            .option('actions', { type: 'string', description: 'The actions to be executed, separated by |', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('outDir', { type: 'string', description: 'The output directory', demandOption: false }) //TODO finish this. Are all of these necessary?
            .option('outFile', { type: 'string', description: 'The output file', demandOption: false })
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('retainedStagingDir', { type: 'boolean', description: 'Should the staging folder be retained after the command is complete', demandOption: false })
            .option('failOnCompileError', { type: 'boolean', description: 'Should the command fail if there is a compile error', demandOption: false })
            .option('deleteDevChannel', { type: 'boolean', description: 'Should the dev channel be deleted', demandOption: false })
            .option('packagePort', { type: 'number', description: 'The port to use for packaging', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The root directory', demandOption: false })
            .option('files', { type: 'array', description: 'The files to be included in the package', demandOption: false })
            .option('username', { type: 'string', description: 'The username for the Roku', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false })
            .usage(`Usage: npx ts-node ./src/cli.ts exec --actions 'stage|zip' --rootDir . --outDir ./out`)
            .example(
                `npx ts-node ./src/cli.ts exec --actions 'stage|zip' --rootDir . --outDir ./out`,
                'Stages the contents of rootDir and then zips the staged files into outDir - Will fail if there is no manifest in the staging folder'
            );
    }, (args: any) => {
        return new ExecCommand(args.actions, args).run();
    })

    .command('keyPress', 'send keypress command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new KeyPressCommand().run(args);
    })

    .command('keyUp', 'send keyup command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new KeyUpCommand().run(args);
    })

    .command('keyDown', 'send keydown command', (builder) => {
        return builder
            .option('key', { type: 'string', description: 'The key to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new KeyDownCommand().run(args);
    })

    .command(['sendText', 'text'], 'Send text command', (builder) => {
        return builder
            .option('text', { type: 'string', description: 'The text to send', demandOption: true })
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false })
            .option('timeout', { type: 'number', description: 'The timeout for the command', demandOption: false });
    }, (args: any) => {
        return new SendTextCommand().run(args);
    })

    .command(['remote-control', 'rc'], 'Provides a way to send a series of ECP key events similar to how Roku Remote Tool works but from the command line', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('remotePort', { type: 'number', description: 'The port to use for remote', demandOption: false });
    }, (args: any) => {
        return new RemoteControlCommand().run(args);
    })

    .command(['stage', 'prepublishToStaging'], 'Copies all of the referenced files to the staging folder', (builder) => {
        return builder
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('rootDir', { type: 'string', description: 'The selected root folder to be copied', demandOption: false })
            .option('files', { type: 'array', description: 'An array of source file paths indicating where the source files are', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new StageCommand().run(args);
    })

    .command('sideload', 'Sideload a pre-existing packaged zip file to a remote Roku', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('zip', { type: 'string', description: 'The file to be sideloaded, relative to cwd.', demandOption: false })
            .option('remoteDebug', { type: 'boolean', description: 'Should the command be run in remote debug mode', demandOption: false })
            .option('remoteDebugConnectEarly', { type: 'boolean', description: 'Should the command connect to the debugger early', demandOption: false })
            .option('failOnCompileError', { type: 'boolean', description: 'Should the command fail if there is a compile error', demandOption: false })
            .option('retainDeploymentArchive', { type: 'boolean', description: 'Should the deployment archive be retained', demandOption: false })
            .option('deleteDevChannel', { type: 'boolean', description: 'Should the dev channel be deleted', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        args.zip = path.resolve(args.cwd, args.zip);
        args.outDir = path.dirname(args.zip);
        args.outFile = path.basename(args.zip);
        return new SideloadCommand().run(args);
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
            .option('devId', { type: 'string', description: 'The dev ID', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new RekeyDeviceCommand().run(args);
    })

    .command(['createSignedPackage', 'sign'], 'Sign a package', (builder) => {
        return builder
            .option('host', { type: 'string', description: 'The IP Address of the host Roku', demandOption: false })
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('signingPassword', { type: 'string', description: 'The password of the signing key', demandOption: false })
            .option('stagingDir', { type: 'string', description: 'The selected staging folder', demandOption: false })
            .option('out', { type: 'string', description: 'The location where the signed package will be saved relative to cwd', demandOption: false, defaultDescription: './out/roku-deploy.pkg' })
            .option('devId', { type: 'string', description: 'The dev ID', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        if (args.out) {
            args.out = path.resolve(args.cwd, args.out);
            args.outDir = path.dirname(args.out);
            args.outFile = path.basename(args.out);
        }
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
            .option('password', { type: 'string', description: 'The password of the host Roku', demandOption: false })
            .option('screenshotDir', { type: 'string', description: 'A full path to the folder where the screenshots should be saved.', demandOption: false })
            .option('screenshotFile', { type: 'string', description: 'The base filename the image file should be given (excluding the extension). Default: screenshot-YYYY-MM-DD-HH.mm.ss.SSS.<jpg|png>', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        return new CaptureScreenshotCommand().run(args);
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
            .option('dir', { type: 'string', description: 'The folder to be zipped', demandOption: false, alias: ['stagingDir', 'stagingdir'] })
            .option('zip', { type: 'string', description: 'the path to the zip file that will be created', demandOption: false })
            .option('cwd', { type: 'string', description: 'The current working directory to use for relative paths', demandOption: false });
    }, (args: any) => {
        if (args.zip) {
            args.zip = path.resolve(args.cwd, args.zip);
            args.outDir = path.dirname(args.zip);
            args.outFile = path.basename(args.zip);
        }
        return new ZipCommand().run(args);
    })

    .argv;
