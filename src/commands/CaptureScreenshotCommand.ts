import { rokuDeploy, util } from '../index';

export class CaptureScreenshotCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.captureScreenshot(options);
    }
}
