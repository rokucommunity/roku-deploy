import * as fsExtra from 'fs-extra';
import * as path from 'path';

export class Util {
    /**
     * Do work within the context of a changed current working directory
     * @param targetCwd
     * @param callback
     */
    public async cwdRun<T>(targetCwd: string | null | undefined, callback: () => Promise<T>) {
        let originalCwd = process.cwd();
        if (targetCwd) {
            process.chdir(targetCwd);
        }

        let result;
        let err;

        try {
            result = await callback();
        } catch (e) {
            err = e;
        }

        if (targetCwd) {
            process.chdir(originalCwd);
        }

        if (err) {
            throw err;
        } else {
            return result;
        }
    }

    /**
     * Determine if the given path is a directory
     * @param path
     */
    public async isDirectory(pathToDirectoryOrFile: string, cwd?: string) {
        try {
            return await this.cwdRun(cwd, async () => {
                let stat = await fsExtra.lstat(pathToDirectoryOrFile);
                return stat.isDirectory();
            });
        } catch (e) {
            // lstatSync throws an error if path doesn't exist
            return false;
        }
    }

    /**
     * Determine if `childPath` is contained within the `parentPath`
     * @param parentPath 
     * @param childPath 
     */
    public isParentOfPath(parentPath: string, childPath: string) {
        const relative = path.relative(parentPath, childPath);
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }
    /**
     * Determines if the given path is a file
     * @param filePathAbsolute 
     */
    public async isFile(filePathAbsolute: string, cwd?: string) {
        try {
            return await this.cwdRun(cwd, async () => {
                let stat = await fsExtra.lstat(filePathAbsolute);
                return stat.isFile();
            });
        } catch (e) {
            // lstatSync throws an error if path doesn't exist
            return false;
        }
    }

    /**
     * Normalize path and replace all directory separators with current OS separators
     * @param thePath 
     */
    public standardizePath(thePath: string) {
        if (!thePath) {
            return thePath;
        }
        return path.normalize(
            thePath.replace(/[\/\\]+/g, path.sep)
        );
    }

    /**
     * Do a case-insensitive string replacement
     * @param haystack 
     * @param needle 
     * @param replace 
     */
    public stringReplaceInsensitive(haystack: string, needle: string, replace: string) {
        let idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
        if (idx > -1) {
            return haystack.substr(0, idx) + replace + haystack.substr(idx + needle.length);
        } else {
            return haystack;
        }
    }
}

export let util = new Util();