import { rokuDeploy, util } from '../index';
import type { CloseChannelOptions } from '../RokuDeploy';
import * as path from 'path';

export class SideloadCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };

        // Process args so that they can be compatible with the RokuDeploy
        args.cwd ??= process.cwd();
        if (args.zip) {
            args.zip = path.resolve(args.cwd, args.zip);
            options.outDir = path.dirname(args.zip);
            options.outFile = path.basename(args.zip);
        }
        if (args.rootDir) {
            options.rootDir = path.resolve(args.cwd, args.rootDir);
        }

        if (args.outZip) {
            options.outZip = path.resolve(args.cwd, args.outZip);
        }

        if (args.ecpPort) {
            options.remotePort = args.ecpPort;
        }

        if (args.noclose !== true) {
            await rokuDeploy.closeChannel(options as CloseChannelOptions);
        }


        if (args.zip) {
            options.retainDeploymentArchive = true;
            await rokuDeploy.sideload(options);
        } else if (args.rootDir) {
            await rokuDeploy.zip(options);
            options.retainDeploymentArchive = false;
            await rokuDeploy.sideload(options);
        } else {
            throw new Error('Either zip or rootDir must be provided for sideload command');
        }
    }
}
