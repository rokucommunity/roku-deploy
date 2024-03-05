import { rokuDeploy, util } from '../index';

export class TakeScreenshotCommand {
    async run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        await rokuDeploy.captureScreenshot(options);
    }
}
