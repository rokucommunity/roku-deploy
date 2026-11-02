import type { CaptureScreenshotOptions } from '../index';
import { createRokuDeploy } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        await createRokuDeploy(args).captureScreenshot({} as CaptureScreenshotOptions);
    }
}
