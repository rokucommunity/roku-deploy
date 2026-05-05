import { util, standardizePath as s } from './util';
import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { tempDir } from './testUtils.spec';
import * as path from 'path';
import * as dns from 'dns';
import { createSandbox } from 'sinon';
const sinon = createSandbox();

describe('util', () => {
    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        sinon.restore();
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('isFile', () => {
        it('recognizes valid files', async () => {
            expect(await util.isFile(util.standardizePath(`${process.cwd()}/README.md`))).to.be.true;
        });
        it('recognizes non-existant files', async () => {
            expect(await util.isFile(util.standardizePath(`${process.cwd()}/FILE_THAT_DOES_NOT_EXIST.md`))).to.be.false;
        });
    });

    describe('toForwardSlashes', () => {
        it('returns original value for non-strings', () => {
            expect(util.toForwardSlashes(undefined)).to.be.undefined;
            expect(util.toForwardSlashes(<any>false)).to.be.false;
        });

        it('converts mixed slashes to forward', () => {
            expect(util.toForwardSlashes('a\\b/c\\d/e')).to.eql('a/b/c/d/e');
        });
    });

    describe('isChildOfPath', () => {
        it('works for child path', () => {
            let parentPath = `${process.cwd()}\\testProject`;
            let childPath = `${process.cwd()}\\testProject\\manifest`;
            expect(util.isParentOfPath(parentPath, childPath), `expected '${childPath}' to be child path of '${parentPath}'`).to.be.true;
            //inverse is not true
            expect(util.isParentOfPath(childPath, parentPath), `expected '${parentPath}' NOT to be child path of '${childPath}'`).to.be.false;
        });

        it('handles mixed path separators', () => {
            let parentPath = `${process.cwd()}\\testProject`;
            let childPath = `${process.cwd()}\\testProject/manifest`;
            expect(util.isParentOfPath(parentPath, childPath), `expected '${childPath}' to be child path of '${parentPath}'`).to.be.true;
        });

        it('handles relative path traversals', () => {
            let parentPath = `${process.cwd()}\\testProject`;
            let childPath = `${process.cwd()}/testProject/../testProject/manifest`;
            expect(util.isParentOfPath(parentPath, childPath), `expected '${childPath}' to be child path of '${parentPath}'`).to.be.true;
        });

        it('works with trailing slashes', () => {
            let parentPath = `${process.cwd()}/testProject/`;
            let childPath = `${process.cwd()}/testProject/../testProject/manifest`;
            expect(util.isParentOfPath(parentPath, childPath), `expected '${childPath}' to be child path of '${parentPath}'`).to.be.true;
        });

        it('works with duplicate slashes', () => {
            let parentPath = `${process.cwd()}///testProject/`;
            let childPath = `${process.cwd()}/testProject///testProject//manifest`;
            expect(util.isParentOfPath(parentPath, childPath), `expected '${childPath}' to be child path of '${parentPath}'`).to.be.true;
        });
    });

    describe('stringReplaceInsensitive', () => {
        it('works for varying case', () => {
            expect(util.stringReplaceInsensitive('aBcD', 'bCd', 'bcd')).to.equal('abcd');
        });

        it('returns the original string if the needle was not found in the haystack', () => {
            expect(util.stringReplaceInsensitive('abcd', 'efgh', 'EFGH')).to.equal('abcd');
        });
    });

    describe('tryRepeatAsync', () => {
        it('calls callback', async () => {
            let count = 0;
            await util.tryRepeatAsync(() => {
                count++;
                if (count < 3) {
                    throw new Error('test tryRepeatAsync');
                }
            }, 10, 0);
            expect(count).to.equal(3);
        });

        it('raises exception after max tries has been reached', async () => {
            let error;
            try {
                await util.tryRepeatAsync(() => {
                    throw new Error('test tryRepeatAsync');
                }, 3, 1);
            } catch (e) {
                error = e;
            }
            expect(error).to.exist;
        });
    });

    describe('globAllByIndex', () => {
        function writeFiles(filePaths: string[], cwd = tempDir) {
            for (const filePath of filePaths) {
                fsExtra.outputFileSync(
                    path.resolve(cwd, filePath),
                    ''
                );
            }
        }

        async function doTest(patterns: string[], expectedPaths: string[][]) {
            const results = await util.globAllByIndex(patterns, tempDir);
            for (let i = 0; i < results.length; i++) {
                results[i] = results[i]?.map(x => s(x))?.sort();
            }
            for (let i = 0; i < expectedPaths.length; i++) {
                expectedPaths[i] = expectedPaths[i]?.map(x => {
                    return s`${path.resolve(tempDir, x)}`;
                })?.sort();
            }
            expect(results).to.eql(expectedPaths);
        }

        it('finds direct file paths', async () => {
            writeFiles([
                'manifest',
                'source/main.brs',
                'components/Component1/lib.brs'
            ]);
            await doTest([
                'manifest',
                'source/main.brs',
                'components/Component1/lib.brs'
            ], [
                [
                    'manifest'
                ], [
                    'source/main.brs'
                ], [
                    'components/Component1/lib.brs'
                ]
            ]);
        });

        it('matches the wildcard glob', async () => {
            writeFiles([
                'manifest',
                'source/main.brs',
                'components/Component1/lib.brs'
            ]);
            await doTest([
                '**/*'
            ], [
                [
                    'manifest',
                    'source/main.brs',
                    'components/Component1/lib.brs'
                ]
            ]);
        });

        it('returns the same file path in multiple matches', async () => {
            writeFiles([
                'manifest',
                'source/main.brs',
                'components/Component1/lib.brs'
            ]);
            await doTest([
                'manifest',
                'source/main.brs',
                'manifest',
                'source/main.brs'
            ], [
                [
                    'manifest'
                ], [
                    'source/main.brs'
                ], [
                    'manifest'
                ], [
                    'source/main.brs'
                ]
            ]);
        });

        it('filters files', async () => {
            writeFiles([
                'manifest',
                'source/main.brs',
                'components/Component1/lib.brs'
            ]);
            await doTest([
                '**/*',
                //filter out brs files
                '!**/*.brs'
            ], [
                [
                    'manifest'
                ],
                null
            ]);
        });

        it('filters files and adds them back in later', async () => {
            writeFiles([
                'manifest',
                'source/main.brs',
                'components/Component1/lib.brs'
            ]);
            await doTest([
                '**/*',
                //filter out brs files
                '!**/*.brs',
                //re-add the main file
                '**/main.brs'
            ], [
                [
                    'manifest'
                ],
                undefined,
                [
                    'source/main.brs'
                ]
            ]);
        });
    });

    describe('filterPaths', () => {
        it('does not crash with bad params', () => {
            //shouldn't crash
            util['filterPaths']('*', [], '', 2);
        });

        it('does not double-up the path when the negation pattern is absolute', () => {
            const absoluteFile = s`${tempDir}/source/main.brs`;
            const filesByIndex = [[absoluteFile]];
            // pattern is an absolute negation like `!C:/tempDir/source/main.brs`
            util['filterPaths'](`!${absoluteFile}`, filesByIndex, s`${tempDir}`, 0);
            // file should be filtered out — if path was doubled it would never match and the file would remain
            expect(filesByIndex[0]).to.eql([]);
        });
    });

    describe('globAllByIndex absolute patterns', () => {
        function writeFiles(filePaths: string[], cwd = tempDir) {
            for (const filePath of filePaths) {
                fsExtra.outputFileSync(path.resolve(cwd, filePath), '');
            }
        }

        it('does not double-up path when pattern is absolute', async () => {
            writeFiles(['source/main.brs']);
            const absolutePattern = s`${tempDir}/source/main.brs`;
            const results = await util.globAllByIndex([absolutePattern], tempDir);
            expect(results[0]?.map(x => s(x))).to.eql([absolutePattern]);
        });

        it('correctly filters files when negation pattern is absolute', async () => {
            writeFiles(['source/main.brs', 'source/lib.brs']);
            const results = await util.globAllByIndex([
                '**/*.brs',
                `!${s`${tempDir}/source/main.brs`}`
            ], tempDir);
            // main.brs should be filtered out; lib.brs should remain
            expect(results[0]?.map(x => s(x)).sort()).to.eql([s`${tempDir}/source/lib.brs`]);
        });
    });

    describe('dnsLookup', () => {
        it('returns ip address for hostname', async () => {
            sinon.stub(dns.promises, 'lookup').returns(Promise.resolve({
                address: '1.2.3.4',
                family: undefined
            }));

            expect(
                await util.dnsLookup('some-host', true)
            ).to.eql('1.2.3.4');
        });

        it('returns ip address for ip address', async () => {
            sinon.stub(dns.promises, 'lookup').returns(Promise.resolve({
                address: '1.2.3.4',
                family: undefined
            }));

            expect(
                await util.dnsLookup('some-host', true)
            ).to.eql('1.2.3.4');
        });

        it('returns given value if the lookup failed', async () => {
            sinon.stub(dns.promises, 'lookup').returns(Promise.resolve({
                address: undefined,
                family: undefined
            }));

            expect(
                await util.dnsLookup('some-host', true)
            ).to.eql('some-host');
        });
    });

    describe('decodeHtmlEntities', () => {
        it('decodes values properly', () => {
            expect(util.decodeHtmlEntities('&nbsp;')).to.eql(' ');
            expect(util.decodeHtmlEntities('&amp;')).to.eql('&');
            expect(util.decodeHtmlEntities('&quot;')).to.eql('"');
            expect(util.decodeHtmlEntities('&lt;')).to.eql('<');
            expect(util.decodeHtmlEntities('&gt;')).to.eql('>');
            expect(util.decodeHtmlEntities('&#39;')).to.eql(`'`);
        });
    });
});
