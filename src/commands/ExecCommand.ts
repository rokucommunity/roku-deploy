import { util } from '../util';
import { rokuDeploy } from '../RokuDeploy';
import type { CloseChannelOptions, ConvertToSquashfsOptions, CreateSignedPackageOptions, DeleteDevChannelOptions, RekeyDeviceOptions, SideloadOptions } from '../RokuDeploy';
import type { RokuDeployOptions } from '../RokuDeployOptions';

export class ExecCommand {
    private actions: string[];

    // eslint-disable-next-line @typescript-eslint/ban-types
    private options: RokuDeployOptions;

    constructor(actions: string, rokuDeployOptions: RokuDeployOptions) {
        this.actions = actions.split('|');
        this.options = rokuDeployOptions;
    }

    async run() {
        //Load options from json, and overwrite with cli options
        this.options = {
            ...util.getOptionsFromJson(this.options),
            ...this.options
        };

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
            // defaults -> config -> cli options
            await rokuDeploy.deleteDevChannel(this.options as DeleteDevChannelOptions);
        }

        if (this.actions.includes('close')) {
            await rokuDeploy.closeChannel(this.options as CloseChannelOptions);
        }

        if (this.actions.includes('sideload')) {
            await rokuDeploy.sideload(this.options as SideloadOptions);
        }

        if (this.actions.includes('stage')) {
            await rokuDeploy.stage(this.options);
        }

        if (this.actions.includes('rekey')) {
            await rokuDeploy.rekeyDevice(this.options as RekeyDeviceOptions);
        }

        if (this.actions.includes('squash')) {
            await rokuDeploy.convertToSquashfs(this.options as ConvertToSquashfsOptions);
        }

        if (this.actions.includes('sign')) {
            await rokuDeploy.createSignedPackage(this.options as CreateSignedPackageOptions);
        }


    }
}
