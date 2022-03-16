import type { StandardizedFileEntry } from './interfaces';

/**
 * A cache used to simplify future operations
 */
export class Cache {
    public constructor(entries: Array<string | StandardizedFileEntry>, data?: Array<Array<StandardizedFileEntry>>) {
        for (const entry of entries) {
            this.cache.push({
                entry: entry,
                files: new Map()
            });
        }
        if (data) {
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                if (Array.isArray(row)) {
                    this.setMany(i, ...row);
                }
            }
        }
    }

    private cache: Array<CacheEntry> = [];

    public setMany(patternIndex: number, ...entries: StandardizedFileEntry[]) {
        for (const entry of entries as CacheFile[]) {
            entry.srcLower = entry.src.toLowerCase();
            this.cache[patternIndex].files.set(entry.dest.toLowerCase(), entry);
        }
    }

    public set(patternIndex: number, src: string, dest: string) {
        this.setMany(patternIndex, { src: src, dest: dest });
    }

    public deleteBySrc(patternIndex: number, src: string) {
        src = src.toLowerCase();
        const cacheRow = this.cache[patternIndex];
        for (const [dest, entry] of cacheRow.files) {
            if (entry.srcLower === src) {
                return cacheRow.files.delete(dest);
            }
        }
        return false;
    }

    public deleteByDest(patternIndex: number, dest: string) {
        return this.cache[patternIndex].files.delete(dest.toLowerCase());
    }

    /**
     *
     */
    public getBySrc(patternIndex: number, src: string) {
        src = src.toLowerCase();
        const cacheRow = this.cache[patternIndex];
        for (const [, entry] of cacheRow.files) {
            if (entry.srcLower === src) {
                return entry;
            }
        }
    }

    /**
     *
     */
    public getByDest(patternIndex: number, dest: string) {
        return this.cache[patternIndex].files.get(dest.toLowerCase());
    }

    /**
     *
     */
    public hasBySrc(patternIndex: number, src: string) {
        return !!this.getBySrc(patternIndex, src);
    }

    /**
     *
     */
    public hasByDest(patternIndex: number, dest: string) {
        return !!this.getByDest(patternIndex, dest);
    }

    public validate(entries: Array<string | StandardizedFileEntry>) {
        if (entries.length !== this.cache.length) {
            throw new Error('`entries` must be the same length as `this.cache`');
        }
        for (let i = 0; i < entries.length; i++) {
            const incomingEntry = entries[i];
            const cacheEntry = this.cache[i].entry;
            if (typeof cacheEntry === 'string') {
                if (cacheEntry !== incomingEntry) {
                    throw new Error(`entry mismatch at index ${i}: "${cacheEntry}" !== "${incomingEntry}"`);
                }
            } else if (typeof incomingEntry === 'string' || cacheEntry.src !== (incomingEntry as any).src || cacheEntry.dest !== (incomingEntry as any).dest) {
                throw new Error(`entry mismatch at index ${i}: ${JSON.stringify(cacheEntry.src)} !== ${JSON.stringify(incomingEntry)}`);
            }
        }
    }

    /**
     * Get all dest paths for a given src. This will exclude dest paths that were overridden by a higher priority file (i.e. files that override this one)
     */
    public getAllDestForSrc(src: string) {
        src = src.toLowerCase();
        const destPaths = new Set<string>();

        //first look up every dest path for this file
        for (let i = 0; i < this.cache.length; i++) {
            const item = this.getBySrc(i, src);
            if (item) {
                destPaths.add(item.dest.toLowerCase());
            }
        }

        //discard any dest paths belonging to higher-indexed files (i.e. files that override this one)
        const result = [...destPaths].map(dest => {
            const lastEntry = this.cache.map(x => x.files.get(dest)).filter(x => !!x).pop();
            if (lastEntry && lastEntry.srcLower === src) {
                return lastEntry.dest;
            } else {
                return undefined;
            }
        }).filter(x => !!x);
        return result;
    }
}

interface CacheEntry {
    entry: string | StandardizedFileEntry;
    files: Map<string, CacheFile>;
}

interface CacheFile extends StandardizedFileEntry {
    srcLower: string;
}
