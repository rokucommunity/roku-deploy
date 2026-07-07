import { rokuDeploy, RokuDeploy } from '../index';

export class CaptureScreenshotCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.captureScreenshot(options);
    }
}
