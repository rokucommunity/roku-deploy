import { createRokuDeploy } from './commandUtils';

export class GetDevIdCommand {
    async run(args) {
        const { devId } = await createRokuDeploy(args).getDevId();
        console.log(devId);
    }
}
