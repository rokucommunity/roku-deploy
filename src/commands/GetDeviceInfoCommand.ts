import { rokuDeploy, toTable } from '../index';

export class GetDeviceInfoCommand {
    async run(args) {
        const outputPath = await rokuDeploy.getDeviceInfo({
            host: args.host
        });
        console.log(toTable(outputPath));
    }
}
