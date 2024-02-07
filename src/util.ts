import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as fs from 'fs';
import * as dns from 'dns';
import * as micromatch from 'micromatch';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import fastGlob = require('fast-glob');
import type { FileEntry } from './RokuDeployOptions';
import type { StandardizedFileEntry } from './RokuDeploy';
import * as isGlob from 'is-glob';
import * as picomatch from 'picomatch';

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

    /**
     * Given an array of `FilesType`, normalize them each into a `StandardizedFileEntry`.
     * Each entry in the array or inner `src` array will be extracted out into its own object.
     * This makes it easier to reason about later on in the process.
     * @param files
     */
    public normalizeFilesArray(files: FileEntry[]) {
        const result: Array<string | StandardizedFileEntry> = [];

        for (let i = 0; i < files.length; i++) {
            let entry = files[i];
            //skip falsey and blank entries
            if (!entry) {
                continue;

                //string entries
            } else if (typeof entry === 'string') {
                result.push(entry);

                //objects with src: (string | string[])
            } else if ('src' in entry) {
                //validate dest
                if (entry.dest !== undefined && entry.dest !== null && typeof entry.dest !== 'string') {
                    throw new Error(`Invalid type for "dest" at index ${i} of files array`);
                }

                //objects with src: string
                if (typeof entry.src === 'string') {
                    result.push({
                        src: entry.src,
                        dest: util.standardizePath(entry.dest)
                    });

                    //objects with src:string[]
                } else if ('src' in entry && Array.isArray(entry.src)) {
                    //create a distinct entry for each item in the src array
                    for (let srcEntry of entry.src) {
                        result.push({
                            src: srcEntry,
                            dest: util.standardizePath(entry.dest)
                        });
                    }
                } else {
                    throw new Error(`Invalid type for "src" at index ${i} of files array`);
                }
            } else {
                throw new Error(`Invalid entry at index ${i} in files array`);
            }
        }

        return result;
    }


    /**
    * Get all file paths for the specified options
    * @param files
    * @param rootFolderPath - the absolute path to the root dir where relative files entries are relative to
    */
    public async getFilePaths(files: FileEntry[], rootDir: string): Promise<StandardizedFileEntry[]> {
        //if the rootDir isn't absolute, convert it to absolute using the standard options flow
        if (path.isAbsolute(rootDir) === false) {
            rootDir = this.getOptions({ rootDir: rootDir }).rootDir;
        }
        const entries = this.normalizeFilesArray(files);
        const srcPathsByIndex = await util.globAllByIndex(
            entries.map(x => {
                return typeof x === 'string' ? x : x.src;
            }),
            rootDir
        );

        /**
         * Result indexed by the dest path
         */
        let result = new Map<string, StandardizedFileEntry>();

        //compute `dest` path for every file
        for (let i = 0; i < srcPathsByIndex.length; i++) {
            const srcPaths = srcPathsByIndex[i];
            const entry = entries[i];
            if (srcPaths) {
                for (let srcPath of srcPaths) {
                    srcPath = util.standardizePath(srcPath);

                    const dest = this.computeFileDestPath(srcPath, entry, rootDir);
                    //the last file with this `dest` will win, so just replace any existing entry with this one.
                    result.set(dest, {
                        src: srcPath,
                        dest: dest
                    });
                }
            }
        }
        return [...result.values()];
    }

    /**
     * Given a full path to a file, determine its dest path
     * @param srcPath the absolute path to the file. This MUST be a file path, and it is not verified to exist on the filesystem
     * @param files the files array
     * @param rootDir the absolute path to the root dir
     * @param skipMatch - skip running the minimatch process (i.e. assume the file is a match
     * @returns the RELATIVE path to the dest location for the file.
     */
    public getDestPath(srcPathAbsolute: string, files: FileEntry[], rootDir: string, skipMatch = false) {
        srcPathAbsolute = util.standardizePath(srcPathAbsolute);
        rootDir = rootDir.replace(/\\+/g, '/');
        const entries = util.normalizeFilesArray(files);

        function makeGlobAbsolute(pattern: string) {
            return path.resolve(
                path.posix.join(
                    rootDir,
                    //remove leading exclamation point if pattern is negated
                    pattern
                    //coerce all slashes to forward
                )
            ).replace(/\\/g, '/');
        }

        let result: string;

        //add the file into every matching cache bucket
        for (let entry of entries) {
            const pattern = (typeof entry === 'string' ? entry : entry.src);
            //filter previous paths
            if (pattern.startsWith('!')) {
                const keepFile = picomatch('!' + makeGlobAbsolute(pattern.replace(/^!/, '')));
                if (!keepFile(srcPathAbsolute)) {
                    result = undefined;
                }
            } else {
                const keepFile = picomatch(makeGlobAbsolute(pattern));
                if (keepFile(srcPathAbsolute)) {
                    try {
                        result = this.computeFileDestPath(
                            srcPathAbsolute,
                            entry,
                            util.standardizePath(rootDir)
                        );
                    } catch {
                        //ignore errors...the file just has no dest path
                    }
                }
            }
        }
        return result;
    }

    /**
     * Compute the `dest` path. This accounts for magic globstars in the pattern,
     * as well as relative paths based on the dest. This is only used internally.
     * @param src an absolute, normalized path for a file
     * @param dest the `dest` entry for this file. If omitted, files will derive their paths relative to rootDir.
     * @param pattern the glob pattern originally used to find this file
     * @param rootDir absolute normalized path to the rootDir
     */
    private computeFileDestPath(srcPath: string, entry: string | StandardizedFileEntry, rootDir: string) {
        let result: string;
        let globstarIdx: number;
        //files under rootDir with no specified dest
        if (typeof entry === 'string') {
            if (util.isParentOfPath(rootDir, srcPath, false)) {
                //files that are actually relative to rootDir
                result = util.stringReplaceInsensitive(srcPath, rootDir, '');
            } else {
                // result = util.stringReplaceInsensitive(srcPath, rootDir, '');
                throw new Error('Cannot reference a file outside of rootDir when using a top-level string. Please use a src;des; object instead');
            }

            //non-glob-pattern explicit file reference
        } else if (!isGlob(entry.src.replace(/\\/g, '/'), { strict: false })) {
            let isEntrySrcAbsolute = path.isAbsolute(entry.src);
            let entrySrcPathAbsolute = isEntrySrcAbsolute ? entry.src : util.standardizePath(`${rootDir}/${entry.src}`);

            let isSrcChildOfRootDir = util.isParentOfPath(rootDir, entrySrcPathAbsolute, false);

            let fileNameAndExtension = path.basename(entrySrcPathAbsolute);

            //no dest
            if (entry.dest === null || entry.dest === undefined) {
                //no dest, absolute path or file outside of rootDir
                if (isEntrySrcAbsolute || isSrcChildOfRootDir === false) {
                    //copy file to root of staging folder
                    result = fileNameAndExtension;

                    //no dest, relative path, lives INSIDE rootDir
                } else {
                    //copy relative file structure to root of staging folder
                    let srcPathRelative = util.stringReplaceInsensitive(entrySrcPathAbsolute, rootDir, '');
                    result = srcPathRelative;
                }

                //assume entry.dest is the relative path to the folder AND file if applicable
            } else if (entry.dest === '') {
                result = fileNameAndExtension;
            } else {
                result = entry.dest;
            }
            //has a globstar
        } else if ((globstarIdx = entry.src.indexOf('**')) > -1) {
            const rootGlobstarPath = path.resolve(rootDir, entry.src.substring(0, globstarIdx)) + path.sep;
            const srcPathRelative = util.stringReplaceInsensitive(srcPath, rootGlobstarPath, '');
            if (entry.dest) {
                result = `${entry.dest}/${srcPathRelative}`;
            } else {
                result = srcPathRelative;
            }

            //`pattern` is some other glob magic
        } else {
            const fileNameAndExtension = path.basename(srcPath);
            if (entry.dest) {
                result = util.standardizePath(`${entry.dest}/${fileNameAndExtension}`);
            } else {
                result = util.stringReplaceInsensitive(srcPath, rootDir, '');
            }
        }

        result = util.standardizePath(
            //remove leading slashes
            result.replace(/^[\/\\]+/, '')
        );
        return result;
    }

    /**
     * Given a root directory, normalize it to a full path.
     * Fall back to cwd if not specified
     * @param rootDir
     */
    public normalizeRootDir(rootDir: string) {
        if (!rootDir || (typeof rootDir === 'string' && rootDir.trim().length === 0)) {
            return process.cwd();
        } else {
            return path.resolve(rootDir);
        }
    }

    public objectToTableString(deviceInfo: Record<string, any>) {
        const margin = 5;
        const keyWidth = Math.max(...Object.keys(deviceInfo).map(x => x.length)) + margin;
        const valueWidth = Math.max(...Object.values(deviceInfo).map(x => (x ?? '').toString().length)) + margin;
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
