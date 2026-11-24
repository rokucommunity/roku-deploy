import { rokuDeploy } from '../index';
import type { SideloadOptions } from '../index';
import { definedOptions, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

/**
 * `sideload` installs the dev channel; with `--rekey` the signing key is installed first. Each call gets
 * only its own options.
 */
export class SideloadCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice(definedOptions({
                device: resolveDeviceOption(args, config),
                devices: config.devices,
                username: args.username ?? config.username,
                password: args.password ?? config.password,
                packagePort: args.packagePort ?? config.packagePort,
                timeout: args.timeout ?? config.timeout,
                pkg: args.pkg ?? config.rekeySignedPackage,
                signingPassword: args.signingPassword ?? config.signingPassword,
                devId: args.devId ?? config.devId,
                cwd: args.cwd
            }));
        }

        //sideload installs over the dev web server and can close the running channel over ecp, so it takes
        //both the request and ecp options
        await rokuDeploy.sideload(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            username: args.username ?? config.username,
            password: args.password ?? config.password,
            packagePort: args.packagePort ?? config.packagePort,
            ecpPort: args.ecpPort ?? config.ecpPort,
            timeout: args.timeout ?? config.timeout,
            cwd: args.cwd,
            appType: args.appType ?? config.appType,
            close: args.close,
            failOnCompileError: args.failOnCompileError ?? config.failOnCompileError,
            deleteDevChannel: args.deleteDevChannel ?? config.deleteDevChannel,
            autoLaunch: args.autoLaunch ?? config.autoLaunch,
            incrementBuildNumber: args.incrementBuildNumber ?? config.incrementBuildNumber,
            packageUploadOverrides: config.packageUploadOverrides,
            remoteDebug: args.remoteDebug,
            remoteDebugConnectEarly: args.remoteDebugConnectEarly,
            dir: args.dir ?? config.rootDir,
            zip: args.zip
        }) as SideloadOptions);
    }
}
