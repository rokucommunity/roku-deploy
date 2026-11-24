import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson } from './commandUtils';

export class StageCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //stage is a local operation, so it takes only its own options: no device, password or ports.
        //cli args win over the config file; the config `stagingDir` maps to the `out` option.
        await rokuDeploy.stage(definedOptions({
            rootDir: args.rootDir ?? config.rootDir,
            files: args.files ?? config.files,
            out: args.out ?? config.stagingDir,
            incrementBuildNumber: args.incrementBuildNumber ?? config.incrementBuildNumber,
            cwd: args.cwd
        }));
    }
}
