import { rokuDeploy } from '../index';

export class PublishCommand {
    async run(args) {
        await rokuDeploy.publish({
            host: args.host,
            password: args.password,
            outDir: args.outDir,
            outFile: args.outFile
        });
    }
}
