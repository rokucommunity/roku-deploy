import type { RekeyDeviceOptions } from '../index';
import { util } from '../util';
import * as path from 'path';
import { createRokuDeploy } from './commandUtils';

export class RekeyDeviceCommand {
    async run(args) {
        const rokuDeploy = createRokuDeploy(args);
        //--pkg is relative to cwd; a per-call option, so it wins over any pkg the config file sets
        const pkg = args.pkg ? util.standardizePath(path.resolve(args.cwd, args.pkg)) : undefined;
        await rokuDeploy.rekeyDevice((pkg ? { pkg: pkg } : {}) as RekeyDeviceOptions);
    }
}
