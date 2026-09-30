import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class SideloadCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'sideload');

        //the CLI flag is `--rootDir` (matching `stage`), but the library's sideload option is `dir`
        if (options.rootDir !== undefined && options.dir === undefined) {
            const { rootDir, ...rest } = options;
            options = { ...rest, dir: rootDir };
        }

        await rokuDeploy.sideload(options);
    }
}
