import { util } from '../util';
import type { RokuDeployOptions } from '../RokuDeployOptions';
import { rokuDeploy, type CloseChannelOptions, type ConvertToSquashfsOptions, type CreateSignedPackageOptions, type DeleteDevChannelOptions, type RekeyDeviceOptions, type SideloadOptions } from '../RokuDeploy';

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

        if (this.actions.includes('stage')) {
            await rokuDeploy.stage(this.options);
        }

        if (this.actions.includes('zip')) {
            await rokuDeploy.zip(this.options);
        }

        if (this.actions.includes('delete')) {
            try {
                await rokuDeploy.deleteDevChannel(this.options as DeleteDevChannelOptions);
            } catch (e) {
                // note we don't report the error; as we don't actually care that we could not delete - it's just useless noise to log it.
            }
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
