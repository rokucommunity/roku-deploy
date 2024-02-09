import { rokuDeploy } from '../index';

export class ConvertToSquashfsCommand {
    async run(args) {
        await rokuDeploy.convertToSquashfs({
            host: args.host,
            password: args.password
        });
    }
}
