import { rokuDeploy } from '../index';

export class ZipFolderCommand {
    async run(args) {
        await rokuDeploy.zipFolder(
            args.srcFolder,
            args.zipFilePath
        );
    }
}
