import { rokuDeploy } from '../index';
import type { SideloadOptions } from '../index';
import { definedOptions, getConfigOutPath, loadRokuDeployJson, resolveDeviceOption } from './commandUtils';

/**
 * `package` orchestrates the "ship a signed build" flow: the optional steps run in the fixed order
 * rekey -> sideload -> squash before the package is created. Each call gets only its own options.
 */
export class CreateSignedPackageCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

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

        //the `package` command does not offer the per-session remote-debug switches, so they are not passed here
        if (args.sideload) {
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
                packageUploadOverrides: config.packageUploadOverrides,
                dir: args.dir ?? config.rootDir,
                zip: args.zip
            }) as SideloadOptions);
        }

        //a production package should be squashed, so squash runs unless --no-squash (or a config
        //`convertToSquashfs: false`) opts out
        if ((args.squash ?? config.convertToSquashfs) !== false) {
            await rokuDeploy.convertToSquashfs(definedOptions({
                device: resolveDeviceOption(args, config),
                devices: config.devices,
                username: args.username ?? config.username,
                password: args.password ?? config.password,
                packagePort: args.packagePort ?? config.packagePort,
                timeout: args.timeout ?? config.timeout
            }));
        }

        await rokuDeploy.createSignedPackage(definedOptions({
            device: resolveDeviceOption(args, config),
            devices: config.devices,
            username: args.username ?? config.username,
            password: args.password ?? config.password,
            packagePort: args.packagePort ?? config.packagePort,
            timeout: args.timeout ?? config.timeout,
            cwd: args.cwd,
            signingPassword: args.signingPassword ?? config.signingPassword,
            devId: args.devId ?? config.devId,
            out: args.out ?? getConfigOutPath(config),
            appTitle: args.appTitle,
            appVersion: args.appVersion,
            manifestPath: args.manifestPath
        }));
    }
}
