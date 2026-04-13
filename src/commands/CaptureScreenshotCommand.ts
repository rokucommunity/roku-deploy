import { rokuDeploy, util } from '../index';
import * as path from 'path';

export class CaptureScreenshotCommand {
    async run(args) {
        args.cwd ??= process.cwd();

        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };
        if (args.out) {
            args.out = path.resolve(args.cwd, args.out);
            options.screenshotDir = path.dirname(args.out);
            options.screenshotFile = path.basename(args.out);
        }
        await rokuDeploy.captureScreenshot(options);
    }
}
