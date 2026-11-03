import { RokuDeploy } from '../index';
import { util } from '../util';
import * as path from 'path';
import { normalizeCliArgs } from './commandUtils';

export class RekeyDeviceCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        //--pkg is relative to cwd; a per-call option, so it wins over any pkg the config file sets
        const pkg = args.pkg ? util.standardizePath(path.resolve(args.cwd, args.pkg)) : undefined;
        await rokuDeploy.rekeyDevice(pkg ? { pkg: pkg } : {});
    }
}
