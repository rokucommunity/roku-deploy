import * as path from 'path';
import { rokuDeploy } from '../index';
import { util } from '../util';
import { loadCommandOptions } from './commandUtils';

/**
 * `sideload` is the orchestrator for the "ship a signed build" flow. The flow flags run the existing
 * operations in a fixed order around the install: rekey -> sideload -> squash -> package.
 */
export class SideloadCommand {
    async run(args) {
        //the flow flags are CLI-only: strip them so they never reach the library calls
        const { rekey, squash, package: createPackage, pkg, ...options } = loadCommandOptions(args, 'sideload');

        if (rekey) {
            await rokuDeploy.rekeyDevice({
                ...options,
                //resolve relative to cwd like the standalone rekey command; left unset when not given so
                //the library reports the missing option
                ...(pkg ? { pkg: util.standardizePath(path.resolve(options.cwd, pkg)) } : {})
            });
        }

        await rokuDeploy.sideload(options);

        //a production package should be squashed, so squash defaults on when packaging; --no-squash
        //opts out, and --squash on its own squashes without packaging
        const shouldSquash = squash ?? (createPackage === true);
        if (shouldSquash) {
            await rokuDeploy.convertToSquashfs(options);
        }

        if (createPackage) {
            await rokuDeploy.createSignedPackage(options);
        }
    }
}
