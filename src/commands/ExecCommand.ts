import { rokuDeploy } from '../index';
import { cwd } from '../testUtils.spec';
import { util } from '../util';

export class ExecCommand {
    private actions: string[];

    private configPath: string;

    // eslint-disable-next-line @typescript-eslint/ban-types
    private options: {};

    constructor(actions: string, configPath: string, ...rokuDeployOptions) {
        this.actions = actions.split('|');
        this.configPath = configPath;
        this.options = rokuDeployOptions;
    }

    async run() {
        //load options from json
        this.options = util.getOptionsFromJson(this.options);

        // Possibilities:
        // 'stage|zip'
        // 'stage|zip|delete|close|sideload'
        // 'close|rekey|stage|zip|delete|close|sideload|squash|sign'

        if (this.actions.includes('stage')) {
            await rokuDeploy.stage(this.options);
        }

        if (this.actions.includes('zip')) {
            await rokuDeploy.zip(this.options);
        }

        if (this.actions.includes('delete')) {
            await rokuDeploy.deleteDevChannel(this.options);
        }

        if (this.actions.includes('close')) {
            await rokuDeploy.closeChannel(this.options);
        }

        if (this.actions.includes('sideload')) {
            await rokuDeploy.sideload(this.options);
        }

        if (this.actions.includes('stage')) {
            await rokuDeploy.stage(this.options);
        }

        if (this.actions.includes('rekey')) {
            await rokuDeploy.rekeyDevice(this.options);
        }

        if (this.actions.includes('squash')) {
            await rokuDeploy.convertToSquashfs(this.options);
        }

        if (this.actions.includes('sign')) {
            await rokuDeploy.createSignedPackage(this.options);
        }


    }
}
