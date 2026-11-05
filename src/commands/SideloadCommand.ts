import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

/**
 * `sideload` installs the dev channel; with `--rekey` the signing key is installed first. Each call gets
 * only its own options.
 */
export class SideloadCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //--rekey installs the signing key first so the dev channel runs under it
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
}
