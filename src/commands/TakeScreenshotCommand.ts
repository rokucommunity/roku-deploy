import { rokuDeploy } from '../index';

export class TakeScreenshotCommand {
    async run(args) {
        await rokuDeploy.takeScreenshot({
            host: args.host,
            password: args.password
        });
    }
}
