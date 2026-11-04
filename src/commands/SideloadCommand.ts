import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, normalizeCliArgs } from './commandUtils';

/**
 * `sideload` installs the dev channel; with `--rekey` the signing key is installed first. Each call gets
 * only its own options.
 */
export class SideloadCommand {
    async run(args) {
        const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });

        //--rekey installs the signing key first so the dev channel runs under it
        if (args.rekey) {
            await rokuDeploy.rekeyDevice({
                ...extractCommonConfigOptions(config),
                //rekey-specific config options
                pkg: config.rekeySignedPackage,
                signingPassword: config.signingPassword,
                devId: config.devId,
                //cli args win over everything from the config file
                ...normalizeCliArgs(args, config, ['pkg', 'signingPassword', 'devId'])
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
            ...normalizeCliArgs(args, config, ['zip', 'dir', 'close', 'appType', 'remoteDebug', 'remoteDebugConnectEarly', 'failOnCompileError', 'deleteDevChannel'])
        });
    }
}
