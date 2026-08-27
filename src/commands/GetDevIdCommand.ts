import { rokuDeploy } from '../index';

export class GetDevIdCommand {
    async run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };
        const { devId } = await rokuDeploy.getDevId(options);
        console.log(devId);
    }
}
