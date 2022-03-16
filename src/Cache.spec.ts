import { expect } from 'chai';
import { Cache } from './Cache';
import { expectThrows, rootDir } from './testUtils.spec';
import { standardizePath as s } from './util';

describe.only('Cache', () => {
    let cache: Cache;
    beforeEach(() => {
        cache = new Cache(['']);
    });

    it('auto-loads all entries in the constructor', () => {
        cache = new Cache(['', '', ''], [
            [{ src: 'one', dest: 'one' }],
            null,
            [{ src: 'three', dest: 'three' }]
        ]);

        expect(cache.hasBySrc(0, 'one')).to.be.true;
        expect(cache.hasBySrc(2, 'one')).to.be.false;

        expect(cache.hasBySrc(0, 'three')).to.be.false;
        expect(cache.hasBySrc(2, 'three')).to.be.true;
    });

    it('sets and gets case insensitive', () => {
        const src = s`${rootDir}/source/main.brs`;
        const dest = 'source/MAIN.brs';
        cache.set(0, src, dest);
        //sanity check, different file
        expect(cache.hasByDest(0, `${dest}/.tmp`)).to.be.false;

        expect(cache.hasByDest(0, dest)).to.be.true;
        expect(cache.hasByDest(0, dest.toUpperCase())).to.be.true;
        expect(cache.hasByDest(0, dest.toLowerCase())).to.be.true;

        //sanity check: different file

        expect(cache.hasBySrc(0, `${src}.tmp`)).to.be.false;

        expect(cache.hasBySrc(0, src)).to.be.true;
        expect(cache.hasBySrc(0, src.toUpperCase())).to.be.true;
        expect(cache.hasBySrc(0, src.toLowerCase())).to.be.true;
    });

    it('deletes by src case insensitive', () => {
        cache.set(0, 'src', 'dest');
        //sanity check: deleting unkown file is safe
        expect(cache.deleteByDest(0, 'unknown')).to.be.false;

        expect(cache.hasByDest(0, 'dest'));
        expect(cache.deleteByDest(0, 'DEST')).to.be.true;
    });

    it('deletes by src case insensitive', () => {
        cache.set(0, 'src', 'dest');
        //sanity check: deleting unkown file is safe
        expect(cache.deleteBySrc(0, 'unknown')).to.be.false;
        expect(cache.hasBySrc(0, 'src'));


        expect(cache.deleteBySrc(0, 'SRC')).to.be.true;
    });

    describe('validate', () => {
        it('catches validation mismatches', () => {
            function test(first, second) {
                cache = new Cache(first);
                expectThrows(() => {
                    cache.validate(second);
                });
            }
            test(['*.js'], []);
            test(['*.js'], ['file.txt']);
            test(['*.js'], ['1', '2']);
            test(['*.js'], [{ src: '*.js' }]);
            test(['*.js'], [{}]);

            test([{ src: '*.js', dest: undefined }], []);
            test([{ src: '*.js', dest: undefined }], ['file.txt']);
            test([{ src: '*.js', dest: undefined }], ['1', '2']);
            test([{ src: '*.js', dest: undefined }], ['*.js']);
            test([{ src: '*.js', dest: undefined }], ['*.js']);
            test([{ src: '*', dest: '1' }], [{ src: '*', dest: '2' }]);
        });

        it('detects identical patterns', () => {
            function test(first, second = first) {
                cache = new Cache(first);
                cache.validate(second);
            }
            test([]);
            test(['*.js']);
            test(['file.txt']);
            test(['1', '2']);
            test([{ src: '*.js' }]);
        });
    });

    describe('getAllDeestForSrc', () => {
        it('returns empty when file is not in cache', () => {
            expect(cache.getAllDestForSrc('nothing')).to.eql([]);
        });

        it('returns parent when no child', () => {
            cache = new Cache(['', '']);
            cache.set(0, 'src', 'dest');
            cache.set(1, 'childSrc', 'childDest');
            expect(cache.getAllDestForSrc('src')).to.eql(['dest']);
            expect(cache.getAllDestForSrc('childSrc')).to.eql(['childDest']);
        });

        it('returns child when parent exists with same dest', () => {
            cache = new Cache(['', '']);
            cache.set(0, 'parentSrc', 'dest');
            cache.set(1, 'childSrc', 'dest');
            expect(cache.getAllDestForSrc('parentSrc')).to.eql([]);
            expect(cache.getAllDestForSrc('childSrc')).to.eql(['dest']);
        });
    });
});
