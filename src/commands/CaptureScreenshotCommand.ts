import { rokuDeploy } from '../index';

export class CaptureScreenshotCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        await rokuDeploy.captureScreenshot(options);
    }
}
