import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        await rokuDeploy.captureScreenshot({
            ...extractCommonConfigOptions(config),
            //screenshot-specific config options
            screenshotDir: config.screenshotDir,
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
