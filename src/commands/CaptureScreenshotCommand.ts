import { rokuDeploy } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

export class CaptureScreenshotCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //screenshot is a password-auth device call (BaseRequestOptions) plus its own out/screenshotDir/autoExtension
        await rokuDeploy.captureScreenshot(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            username: args.username ?? config.username,
            password: args.password ?? config.password,
            packagePort: args.packagePort ?? config.packagePort,
            timeout: args.timeout ?? config.timeout,
            out: args.out,
            screenshotDir: config.screenshotDir,
            autoExtension: args.autoExtension,
            cwd: args.cwd
        }));
    }
}
