import { expect } from 'chai';
import * as path from 'path';
import { standardizePath, standardizePathPosix } from './index';

describe('index (public entry point)', () => {
    it('re-exports the standardizePath tagged-template helper', () => {
        expect(standardizePath`a/b\\c`).to.equal(`a${path.sep}b${path.sep}c`);
    });

    it('re-exports the standardizePathPosix tagged-template helper', () => {
        expect(standardizePathPosix`a\\b/c`).to.equal('a/b/c');
    });
});
