import { rokuDeploy } from '../index';
import { definedOptions, getConfigOutPath, loadRokuDeployJson } from './commandUtils';

export class ZipCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //zip is local: the dir to zip (config `rootDir`), the file filter (config `files`), and the
        //output path from config outDir/outFile or --out.
        await rokuDeploy.zip(definedOptions({
            dir: args.dir ?? config.rootDir,
            files: args.files ?? config.files,
            out: args.out ?? getConfigOutPath(config),
            cwd: args.cwd
        }));
    }
}
