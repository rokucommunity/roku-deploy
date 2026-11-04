import { RokuDeploy } from '../index';
import type { CaptureScreenshotOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        const rokuDeploy = new RokuDeploy(normalizeCliArgs(args));
        await rokuDeploy.captureScreenshot({} as CaptureScreenshotOptions);
    }
}
