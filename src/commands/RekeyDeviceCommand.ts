import { rokuDeploy } from '../index';

export class RekeyDeviceCommand {
    async run(args) {
        await rokuDeploy.rekeyDevice({
            host: args.host,
            password: args.password,
            rekeySignedPackage: args.rekeySignedPackage,
            signingPassword: args.signingPassword,
            rootDir: args.rootDir,
            devId: args.devId
        });
    }
}
