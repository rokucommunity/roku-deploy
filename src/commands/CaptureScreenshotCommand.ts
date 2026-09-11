import { rokuDeploy } from '../index';
import { loadCommandOptions } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        let options = loadCommandOptions(args, 'screenshot');
        await rokuDeploy.captureScreenshot(options);
    }
}
