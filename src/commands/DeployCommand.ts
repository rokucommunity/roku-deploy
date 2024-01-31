import { rokuDeploy } from '../index';

export class DeployCommand {
    async run(args) {
        await rokuDeploy.deploy({
            host: args.host,
            password: args.password,
            rootDir: args.rootDir
        });
    }
}
