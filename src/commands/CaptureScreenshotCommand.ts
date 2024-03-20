import { rokuDeploy, util } from '../index';

export class CaptureScreenshotCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.captureScreenshot(options);
    }
}
