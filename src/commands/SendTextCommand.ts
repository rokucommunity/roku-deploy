import { rokuDeploy } from '../index';

export class SendTextCommand {
    // this.options = getDefaultArgsFromJson(this.configPath ?? `${cwd}/rokudeploy.json`);TODO
    async run(args) {
        await rokuDeploy.sendText(args.text);
    }
}
