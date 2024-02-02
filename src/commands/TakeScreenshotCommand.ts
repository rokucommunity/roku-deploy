import { rokuDeploy } from '../index';

export class TakeScreenshotCommand {
    async run(args) {
        await rokuDeploy.captureScreenshot({
            host: args.host,
            password: args.password
        });
    }
}
