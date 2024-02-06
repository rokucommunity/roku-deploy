import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as fs from 'fs';
import * as dns from 'dns';
import * as micromatch from 'micromatch';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import fastGlob = require('fast-glob');

export class Util {
    /**
     * Determine if `childPath` is contained within the `parentPath`
     * @param parentPath
     * @param childPath
     * @param standardizePaths if false, the paths are assumed to already be in the same format and are not re-standardized
     */
    public isParentOfPath(parentPath: string, childPath: string, standardizePaths = true) {
        if (standardizePaths) {
            parentPath = util.standardizePath(parentPath);
            childPath = util.standardizePath(childPath);
        }
        const relative = path.relative(parentPath, childPath);
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }

    /**
     * Determines if the given path is a file
     * @param filePathAbsolute
     */
    public async isFile(filePathAbsolute: string) {
        try {
            //get the full path to the file. This should be the same path for files, and the actual path for any symlinks
            let realPathAbsolute = fs.realpathSync(filePathAbsolute);
            let stat = await fsExtra.lstat(realPathAbsolute);
            return stat.isFile();
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
        return path.normalize(thePath).replace(/[\/\\]+/g, path.sep);
    }

    /**
     * Normalize path and replace all directory separators with current OS separators
     * @param thePath
     */
    public standardizePathPosix(thePath: string) {
        if (!thePath) {
            return thePath;
        }
        return path.normalize(thePath).replace(/[\/\\]+/g, '/');
    }


    /**
     * Do a case-insensitive string replacement
     * @param subject the string that will have its contents replaced
     * @param search the search text to find in `subject`
     * @param replace the text to replace `search` with in `subject`
     */
    public stringReplaceInsensitive(subject: string, search: string, replace: string) {
        let idx = subject.toLowerCase().indexOf(search.toLowerCase());
        if (idx > -1) {
            return subject.substring(0, idx) + replace + subject.substr(idx + search.length);
        } else {
            return subject;
        }
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

    /**
     * Determine if a file exists (case insensitive)
     */
    public async fileExistsCaseInsensitive(filePath: string) {
        filePath = this.standardizePath(filePath);
        const lowerFilePath = filePath.toLowerCase();

        const parentDirPath = path.dirname(filePath);

        //file can't exist if its parent dir doesn't exist
        if (await fsExtra.pathExists(parentDirPath) === false) {
            return false;
        }

        //get a list of every file in the parent directory for this file
        const filesInDir = await fsExtra.readdir(parentDirPath);
        //look at each file path until we find the one we're searching for
        for (let dirFile of filesInDir) {
            const dirFilePath = this.standardizePath(`${parentDirPath}/${dirFile}`);
            if (dirFilePath.toLowerCase() === lowerFilePath) {
                return true;
            }
        }
        return false;
    }

    /**
     * Run a series of glob patterns, returning the matches in buckets corresponding to their pattern index.
     */
    public async globAllByIndex(patterns: string[], cwd: string) {
        //force all path separators to unix style
        cwd = cwd.replace(/\\/g, '/');

        const globResults = patterns.map(async (pattern) => {
            //skip negated patterns (we will use them to filter later on)
            if (pattern.startsWith('!')) {
                return pattern;
            } else {
                //run glob matcher

                return fastGlob([pattern], {
                    cwd: cwd,
                    absolute: true,
                    followSymbolicLinks: true,
                    onlyFiles: true
                });
            }
        });

        const matchesByIndex: Array<Array<string>> = [];

        for (let i = 0; i < globResults.length; i++) {
            const globResult = await globResults[i];
            //if the matches collection is missing, this is a filter
            if (typeof globResult === 'string') {
                this.filterPaths(globResult, matchesByIndex, cwd, i - 1);
                matchesByIndex.push(undefined);
            } else {
                matchesByIndex.push(globResult);
            }
        }
        return matchesByIndex;
    }

    /**
     * Filter all of the matches based on a minimatch pattern
     * @param stopIndex the max index of `matchesByIndex` to filter until
     * @param pattern - the pattern used to filter out entries from `matchesByIndex`. Usually preceeded by a `!`
     */
    private filterPaths(pattern: string, filesByIndex: string[][], cwd: string, stopIndex: number) {
        //move the ! to the start of the string to negate the absolute path, replace windows slashes with unix ones
        let negatedPatternAbsolute = '!' + path.posix.join(cwd, pattern.replace(/^!/, ''));
        let filter = micromatch.matcher(negatedPatternAbsolute);
        for (let i = 0; i <= stopIndex; i++) {
            if (filesByIndex[i]) {
                //filter all matches by the specified pattern
                filesByIndex[i] = filesByIndex[i].filter(x => {
                    return filter(x);
                });
            }
        }
    }

    /*
     * Look up the ip address for a hostname. This is cached for the lifetime of the app, or bypassed with the `skipCache` parameter
     * @param host
     * @param skipCache
     * @returns
     */
    public async dnsLookup(host: string, skipCache = false) {
        if (!this.dnsCache.has(host) || skipCache) {
            const result = await dns.promises.lookup(host);
            this.dnsCache.set(host, result.address ?? host);
        }
        return this.dnsCache.get(host);
    }

    private dnsCache = new Map<string, string>();

    /**
     * Decode HTML entities like &nbsp; &#39; to its original character
     */
    public decodeHtmlEntities(encodedString: string) {
        let translateRegex = /&(nbsp|amp|quot|lt|gt);/g;
        let translate = {
            'nbsp': ' ',
            'amp': '&',
            'quot': '"',
            'lt': '<',
            'gt': '>'
        };

        return encodedString.replace(translateRegex, (match, entity) => {
            return translate[entity];
        }).replace(/&#(\d+);/gi, (match, numStr) => {
            let num = parseInt(numStr, 10);
            return String.fromCharCode(num);
        });
    }

    public printObjectToTable(deviceInfo: Record<string, any>) {
        const margin = 5;
        const keyWidth = Math.max(...Object.keys(deviceInfo).map(x => x.length)) + margin;
        const valueWidth = Math.max(...Object.values(deviceInfo).map(x => (x ?? '')?.toString().length)) + margin;
        let table = [];
        table.push('Name'.padEnd(keyWidth, ' ') + 'Value'.padEnd(keyWidth, ' '));
        table.push('-'.repeat(keyWidth + valueWidth));
        for (const [key, value] of Object.entries(deviceInfo)) {
            table.push(key.padEnd(keyWidth, ' ') + value?.toString().padEnd(keyWidth, ' '));
        }

        return table.join('\n');
    }

}

export let util = new Util();


/**
 * A tagged template literal function for standardizing the path.
 */
export function standardizePath(stringParts, ...expressions: any[]) {
    let result = [];
    for (let i = 0; i < stringParts.length; i++) {
        result.push(stringParts[i], expressions[i]);
    }
    return util.standardizePath(
        result.join('')
    );
}

/**
 * A tagged template literal function for standardizing the path and making all path separators forward slashes
 */
export function standardizePathPosix(stringParts, ...expressions: any[]) {
    let result = [];
    for (let i = 0; i < stringParts.length; i++) {
        result.push(stringParts[i], expressions[i]);
    }
    return util.standardizePathPosix(
        result.join('')
    );
}
