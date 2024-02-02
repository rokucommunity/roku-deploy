import { rokuDeploy } from '../index';

export class PrepublishCommand {
    async run(args) {
        await rokuDeploy.stage({
            stagingDir: args.stagingDir,
            rootDir: args.rootDir
        });
    }
}
