import { util, standardizePath as s } from './util';
import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { cwd, tempDir, rootDir } from './testUtils.spec';
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
        fsExtra.emptyDirSync(tempDir);
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
        function writeFiles(filePaths: string[], dir = tempDir) {
            for (const filePath of filePaths) {
                fsExtra.outputFileSync(
                    path.resolve(dir, filePath),
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

    describe('objectToTableString', () => {
        it('should print an object to a table', () => {
            const deviceInfo = {
                'device-id': '1234',
                'serial-number': 'abcd'
            };

            const result = util.objectToTableString(deviceInfo);

            const expectedOutput = [
                'Name              Value             ',
                '---------------------------',
                'device-id         1234              ',
                'serial-number     abcd              '
            ].join('\n');

            expect(result).to.eql(expectedOutput);
        });

        it('should still print a table when a value is null', () => {
            const deviceInfo = {
                'device-id': '1234',
                'serial-number': null
            };

            const result = util.objectToTableString(deviceInfo);

            const expectedOutput = [
                'Name              Value             ',
                '---------------------------',
                'device-id         1234              ',
                'serial-number     undefined'
            ].join('\n');

            expect(result).to.eql(expectedOutput);
        });
    });

    describe('normalizeRootDir', () => {
        it('handles falsey values', () => {
            expect(util.normalizeRootDir(null)).to.equal(cwd);
            expect(util.normalizeRootDir(undefined)).to.equal(cwd);
            expect(util.normalizeRootDir('')).to.equal(cwd);
            expect(util.normalizeRootDir(' ')).to.equal(cwd);
            expect(util.normalizeRootDir('\t')).to.equal(cwd);
        });

        it('handles non-falsey values', () => {
            expect(util.normalizeRootDir(cwd)).to.equal(cwd);
            expect(util.normalizeRootDir('./')).to.equal(cwd);
            expect(util.normalizeRootDir('./testProject')).to.equal(path.join(cwd, 'testProject'));
        });
    });

    describe('getDestPath', () => {
        it('handles unrelated exclusions properly', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/components/comp1/comp1.brs`,
                    [
                        '**/*',
                        '!exclude.me'
                    ],
                    rootDir
                )
            ).to.equal(s`components/comp1/comp1.brs`);
        });

        it('finds dest path for top-level path', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/components/comp1/comp1.brs`,
                    ['components/**/*'],
                    rootDir
                )
            ).to.equal(s`components/comp1/comp1.brs`);
        });

        it('does not find dest path for non-matched top-level path', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/source/main.brs`,
                    ['components/**/*'],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('excludes a file that is negated', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/source/main.brs`,
                    [
                        'source/**/*',
                        '!source/main.brs'
                    ],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('excludes file from non-rootdir top-level pattern', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/../externalDir/source/main.brs`,
                    [
                        '!../externalDir/**/*'
                    ],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('excludes a file that is negated in src;dest;', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/source/main.brs`,
                    [
                        'source/**/*',
                        {
                            src: '!source/main.brs'
                        }
                    ],
                    rootDir
                )
            ).to.be.undefined;
        });

        it('works for brighterscript files', () => {
            let destPath = util.getDestPath(
                util.standardizePath(`${cwd}/src/source/main.bs`),
                [
                    'manifest',
                    'source/**/*.bs'
                ],
                s`${cwd}/src`
            );
            expect(s`${destPath}`).to.equal(s`source/main.bs`);
        });

        it('excludes a file found outside the root dir', () => {
            expect(
                util.getDestPath(
                    s`${rootDir}/../source/main.brs`,
                    [
                        '../source/**/*'
                    ],
                    rootDir
                )
            ).to.be.undefined;
        });
    });

    describe('getOptionsFromJson', () => {
        it('should fill in options from rokudeploy.json', () => {
            fsExtra.outputJsonSync(s`${rootDir}/rokudeploy.json`, { password: 'password' });
            expect(
                util.getOptionsFromJson({ cwd: rootDir })
            ).to.eql({
                password: 'password'
            });
        });

        it(`loads cwd from process`, () => {
            try {
                fsExtra.outputJsonSync(s`${process.cwd()}/rokudeploy.json`, { host: '1.2.3.4' });
                expect(
                    util.getOptionsFromJson()
                ).to.eql({
                    host: '1.2.3.4'
                });
            } finally {
                fsExtra.removeSync(s`${process.cwd()}/rokudeploy.json`);
            }
        });

        it('catches invalid json with jsonc parser', () => {
            fsExtra.writeJsonSync(s`${process.cwd()}/rokudeploy.json`, { host: '1.2.3.4' });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                {
                    "rootDir": "src"
            `);
            let ex;
            try {
                util.getOptionsFromJson();
            } catch (e) {
                console.log(e);
                ex = e;
            }
            expect(ex).to.exist;
            expect(ex.message.startsWith('Error parsing')).to.be.true;
            fsExtra.removeSync(s`${process.cwd()}/rokudeploy.json`);
        });

        it('works when loading stagingDir from rokudeploy.json', () => {
            sinon.stub(fsExtra, 'existsSync').callsFake((filePath) => {
                return true;
            });
            sinon.stub(fsExtra, 'readFileSync').returns(`
                {
                    "stagingDir": "./staging-dir"
                }
            `);
            let options = util.getOptionsFromJson();
            expect(options.stagingDir.endsWith('staging-dir')).to.be.true;
        });

        it('supports jsonc for rokudeploy.json', () => {
            fsExtra.writeFileSync(s`${tempDir}/rokudeploy.json`, `
                //leading comment
                {
                    //inner comment
                    "rootDir": "src" //trailing comment
                }
                //trailing comment
            `);
            let options = util.getOptionsFromJson({ cwd: tempDir });
            expect(options.rootDir).to.equal('src');
        });
    });

    describe('computeFileDestPath', () => {
        it('treats {src;dest} without dest as a top-level string', () => {
            expect(
                util['computeFileDestPath'](s`${rootDir}/source/main.brs`, { src: s`source/main.brs` } as any, rootDir)
            ).to.eql(s`source/main.brs`);
        });
    });
});
