import { rokuDeploy } from '../index';
import { definedOptions, getConfigOutPath, loadRokuDeployJson } from './commandUtils';

export class ZipCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //zip is local: the dir to zip (config `stagingDir`), a cli-only file filter (config `files` is for
        //staging, not zip), and the output path from config outDir/outFile or --out.
        await rokuDeploy.zip(definedOptions({
            dir: args.dir ?? config.stagingDir,
            files: args.files,
            out: args.out ?? getConfigOutPath(config),
            cwd: args.cwd
        }));
    }
}
