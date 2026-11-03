import { RokuDeploy } from '../index';
import type { CaptureScreenshotOptions } from '../index';
import { normalizeCliArgs } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        await new RokuDeploy(normalizeCliArgs(args)).captureScreenshot({} as CaptureScreenshotOptions);
    }
}
