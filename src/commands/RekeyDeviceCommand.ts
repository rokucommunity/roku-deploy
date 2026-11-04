import { rokuDeploy } from '../index';
import { extractCommonConfigOptions, loadRokuDeployJson, normalizeCliArgs } from './commandUtils';

export class RekeyDeviceCommand {
    async run(args) {
        const config = loadRokuDeployJson(args);

        //the library resolves a relative pkg against cwd itself
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
}
