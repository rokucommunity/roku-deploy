import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, normalizeCliArgs } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });

        await rokuDeploy.captureScreenshot({
            ...extractCommonConfigOptions(config),
            //screenshot-specific config options
            screenshotDir: config.screenshotDir,
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config, ['out', 'autoExtension'])
        });
    }
}
