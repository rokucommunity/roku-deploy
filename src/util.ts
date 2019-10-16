import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as fs from 'fs';
import { SourceNode } from 'source-map';

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
        parentPath =util.standardizePath(parentPath);
        childPath = util.standardizePath(childPath);
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
                //get the full path to the file. This should be the same path for files, and the actual path for any symlinks
                let realPathAbsolute = fs.realpathSync(filePathAbsolute);
                let stat = await fsExtra.lstat(realPathAbsolute);
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

    public async getSourceMap(sourcePathAbsolute: string) {
        let text = (await fsExtra.readFileSync(sourcePathAbsolute)).toString();
        let lines = text.split(/\r?\n/g);
        let chunks = [] as SourceNode[];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            //include the newline if applicable
            line = i === 0 ? '' : '\n' + line;
            chunks.push(
                //SourceNode line numbers start at 1
                new SourceNode(i + 1, 0, sourcePathAbsolute, line)
            );
        }
        let result = new SourceNode(null, null, sourcePathAbsolute, chunks).toStringWithSourceMap();
        return result;
    }

    /**
     * Keep calling the callback until it does NOT throw an exception, or until the max number of tries has been reached.
     * @param callback 
     * @param maxTries 
     * @param sleepMilliseconds 
     */
    /* istanbul ignore next */ //typescript generates some weird while statement that can't get fully covered for some reason
    public async tryRepeatAsync<T>(callback, maxTries = 10, sleepMilliseconds = 50): Promise<T> {
        let tryCount = 0;
        while (true) {
            try {
                return await Promise.resolve(callback());
            } catch (e) {
                tryCount++;
                if (tryCount > maxTries) {
                    throw e;
                } else {
                    await this.sleep(sleepMilliseconds);
                }
            }
        }
    }

    public async sleep(milliseconds: number) {
        await new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }
}

export let util = new Util();