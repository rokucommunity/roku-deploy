import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, getConfigOutPath, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

/**
 * `package` orchestrates the "ship a signed build" flow: the optional steps run in the fixed order
 * rekey -> sideload -> squash before the package is created. Each call gets only its own options.
 */
export class CreateSignedPackageCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        if (args.rekey) {
            await rokuDeploy.rekeyDevice({
                ...extractCommonConfigOptions(config),
                //rekey-specific config options
                pkg: config.rekeySignedPackage,
                signingPassword: config.signingPassword,
                devId: config.devId,
                //cli args win over everything from the config file
                ...normalizeCliArgs(args, config)
            });
        }

        if (args.sideload) {
            await rokuDeploy.sideload({
                ...extractCommonConfigOptions(config),
                //sideload-specific config options
                appType: config.appType,
                failOnCompileError: config.failOnCompileError,
                deleteDevChannel: config.deleteDevChannel ?? config.deleteInstalledChannel,
                packageUploadOverrides: config.packageUploadOverrides,
                //cli args win over everything from the config file
                ...normalizeCliArgs(args, config)
            });
        }

        //a production package should be squashed, so squash runs unless --no-squash (or a config
        //`convertToSquashfs: false`) opts out
        if ((args.squash ?? config.convertToSquashfs) !== false) {
            await rokuDeploy.convertToSquashfs({
                ...extractCommonConfigOptions(config),
                //cli args win over everything from the config file
                ...normalizeCliArgs(args, config)
            });
        }

        await rokuDeploy.createSignedPackage({
            ...extractCommonConfigOptions(config),
            //package-specific config options
            signingPassword: config.signingPassword,
            devId: config.devId,
            out: getConfigOutPath(config),
            //cli args win over everything from the config file
            ...normalizeCliArgs(args, config)
        });
    }
}
