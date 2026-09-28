import { expect } from 'chai';
import * as path from 'path';
import { getDestPath, standardizePath, standardizePathPosix } from './index';

describe('index (public entry point)', () => {
    it('re-exports the standardizePath tagged-template helper', () => {
        expect(standardizePath`a/b\\c`).to.equal(`a${path.sep}b${path.sep}c`);
    });

    it('re-exports the getDestPath helper', () => {
        const rootDir = process.cwd();
        expect(
            getDestPath(`${rootDir}/source/main.brs`, ['source/**/*'], rootDir)
        ).to.equal(`source${path.sep}main.brs`);
        expect(
            getDestPath(`${rootDir}/unmatched/main.brs`, ['source/**/*'], rootDir)
        ).to.be.undefined;
    });

    it('re-exports the standardizePathPosix tagged-template helper', () => {
        expect(standardizePathPosix`a\\b/c`).to.equal('a/b/c');
    });
});
