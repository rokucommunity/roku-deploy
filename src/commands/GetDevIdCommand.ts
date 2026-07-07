import { rokuDeploy, RokuDeploy } from '../index';

export class GetDevIdCommand {
    async run(args) {
        let options = {
            ...RokuDeploy.loadConfigFile(args),
            ...args
        };
        const devId = await rokuDeploy.getDevId(options);
        console.log(devId);
    }
}
