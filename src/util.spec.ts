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

    describe('standardizePathPosix', () => {
        it('returns falsey value back unchanged', () => {
            expect(util.standardizePathPosix(null)).to.eql(null);
            expect(util.standardizePathPosix(undefined)).to.eql(undefined);
            expect(util.standardizePathPosix(false as any)).to.eql(false);
            expect(util.standardizePathPosix(0 as any)).to.eql(0);
        });

        it('always returns forward slashes', () => {
            expect(util.standardizePathPosix('C:\\projects/some\\folder')).to.eql('C:/projects/some/folder');
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

    describe('fileExistsCaseInsensitive', () => {
        it('detects when a file does not exist inside a dir that does exist', async () => {
            fsExtra.ensureDirSync(tempDir);
            expect(
                await util.fileExistsCaseInsensitive(s`${tempDir}/not-there`)
            ).to.be.false;
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

    describe('printObjectToTable', () => {
        it('should print an object to a table', () => {
            const deviceInfo = {
                'device-id': '1234',
                'serial-number': 'abcd'
            };

            const result = util.printObjectToTable(deviceInfo);

            const expectedOutput = [
                'Name              Value             ',
                '---------------------------',
                'device-id         1234              ',
                'serial-number     abcd              '
            ].join('\n');

            expect(result).to.eql(expectedOutput);
        });
    });
});
