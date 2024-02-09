import { rokuDeploy } from '../index';

export class PrepublishCommand {
    async run(args) {
        await rokuDeploy.prepublishToStaging({
            stagingDir: args.stagingDir,
            rootDir: args.rootDir
        });
    }
}
