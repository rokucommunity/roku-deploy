import { util, standardizePath as s, standardizePathPosix as sp } from './util';
import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { cwd, tempDir, rootDir, outDir, expectThrowsAsync, writeFiles } from './testUtils.spec';
import * as path from 'path';
import * as dns from 'dns';
import { createSandbox } from 'sinon';
import { RokuDeploy } from './RokuDeploy';
import type { FileEntry, RokuDeployOptions } from './RokuDeployOptions';
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

    describe('getFilePaths', () => {
        const otherProjectName = 'otherProject';
        const otherProjectDir = sp`${rootDir}/../${otherProjectName}`;
        let rokuDeploy: RokuDeploy;
        let options: RokuDeployOptions;
        //create baseline project structure
        beforeEach(() => {
            rokuDeploy = new RokuDeploy();
            options = rokuDeploy.getOptions({});
            fsExtra.ensureDirSync(`${rootDir}/components/emptyFolder`);
            writeFiles(rootDir, [
                `manifest`,
                `source/main.brs`,
                `source/lib.brs`,
                `components/component1.xml`,
                `components/component1.brs`,
                `components/screen1/screen1.xml`,
                `components/screen1/screen1.brs`
            ]);
        });

        async function getFilePaths(files: FileEntry[], rootDirOverride = rootDir) {
            return (await util.getFilePaths(files, rootDirOverride))
                .sort((a, b) => a.src.localeCompare(b.src));
        }

        describe('top-level-patterns', () => {
            it('excludes a file that is negated', async () => {
                expect(await getFilePaths([
                    'source/**/*',
                    '!source/main.brs'
                ])).to.eql([{
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }]);
            });

            it('excludes file from non-rootdir top-level pattern', async () => {
                writeFiles(rootDir, ['../externalDir/source/main.brs']);
                expect(await getFilePaths([
                    '../externalDir/**/*',
                    '!../externalDir/**/*'
                ])).to.eql([]);
            });

            it('throws when using top-level string referencing file outside the root dir', async () => {
                writeFiles(rootDir, [`../source/main.brs`]);
                await expectThrowsAsync(async () => {
                    await getFilePaths([
                        '../source/**/*'
                    ]);
                }, 'Cannot reference a file outside of rootDir when using a top-level string. Please use a src;des; object instead');
            });

            it('works for brighterscript files', async () => {
                writeFiles(rootDir, ['src/source/main.bs']);
                expect(await getFilePaths([
                    'manifest',
                    'source/**/*.bs'
                ], s`${rootDir}/src`)).to.eql([{
                    src: s`${rootDir}/src/source/main.bs`,
                    dest: s`source/main.bs`
                }]);
            });

            it('works for root-level double star in top-level pattern', async () => {
                expect(await getFilePaths([
                    '**/*'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                },
                {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                },
                {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                },
                {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('works for multile entries', async () => {
                expect(await getFilePaths([
                    'source/**/*',
                    'components/**/*',
                    'manifest'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }, {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                }, {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('copies top-level-string single-star globs', async () => {
                writeFiles(rootDir, [
                    'source/lib.brs',
                    'source/main.brs'
                ]);
                expect(await getFilePaths([
                    'source/*.brs'
                ])).to.eql([{
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('works for double-star globs', async () => {
                expect(await getFilePaths([
                    '**/*.brs'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('copies subdir-level relative double-star globs', async () => {
                expect(await getFilePaths([
                    'components/**/*.brs'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }]);
            });

            it('Finds folder using square brackets glob pattern', async () => {
                fsExtra.outputFileSync(`${rootDir}/e/file.brs`, '');
                expect(await getFilePaths([
                    '[test]/*'
                ],
                rootDir
                )).to.eql([{
                    src: s`${rootDir}/e/file.brs`,
                    dest: s`e/file.brs`
                }]);
            });

            it('Finds folder with escaped square brackets glob pattern as name', async () => {
                fsExtra.outputFileSync(`${rootDir}/[test]/file.brs`, '');
                fsExtra.outputFileSync(`${rootDir}/e/file.brs`, '');
                expect(await getFilePaths([
                    '\\[test\\]/*'
                ],
                rootDir
                )).to.eql([{
                    src: s`${rootDir}/[test]/file.brs`,
                    dest: s`[test]/file.brs`
                }]);
            });

            it('throws exception when top-level strings reference files not under rootDir', async () => {
                writeFiles(otherProjectDir, [
                    'manifest'
                ]);
                await expectThrowsAsync(
                    getFilePaths([
                        `../${otherProjectName}/**/*`
                    ])
                );
            });

            it('applies negated patterns', async () => {
                expect(await getFilePaths([
                    //include all components
                    'components/**/*.brs',
                    //exclude all xml files
                    '!components/**/*.xml',
                    //re-include a specific xml file
                    'components/screen1/screen1.xml'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }]);
            });

            it('handles negated multi-globs', async () => {
                expect((await getFilePaths([
                    'components/**/*',
                    '!components/screen1/**/*'
                ])).map(x => x.dest)).to.eql([
                    s`components/component1.brs`,
                    s`components/component1.xml`
                ]);
            });

            it('allows negating paths outside rootDir without requiring src;dest; syntax', async () => {
                fsExtra.outputFileSync(`${rootDir}/../externalLib/source/lib.brs`, '');
                const filePaths = await getFilePaths([
                    'source/**/*',
                    { src: '../externalLib/**/*', dest: 'source' },
                    '!../externalLib/source/**/*'
                ], rootDir);
                expect(
                    filePaths.map(x => s`${x.src}`).sort()
                ).to.eql([
                    s`${rootDir}/source/lib.brs`,
                    s`${rootDir}/source/main.brs`
                ]);
            });

            it('applies multi-glob paths relative to rootDir', async () => {
                expect(await getFilePaths([
                    'manifest',
                    'source/**/*',
                    'components/**/*',
                    '!components/scenes/**/*'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }, {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                }, {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }, {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('ignores non-glob folder paths', async () => {
                expect(await getFilePaths([
                    //this is the folder called "components"
                    'components'
                ])).to.eql([]); //there should be no matches because rokudeploy ignores folders
            });

        });

        describe('{src;dest} objects', () => {
            it('excludes a file that is negated in src;dest;', async () => {
                expect(await getFilePaths([
                    'source/**/*',
                    {
                        src: '!source/main.brs'
                    }
                ])).to.eql([{
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                }]);
            });

            it('works for root-level double star in {src;dest} object', async () => {
                expect(await getFilePaths([{
                    src: '**/*',
                    dest: ''
                }
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/component1.xml`,
                    dest: s`components/component1.xml`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                },
                {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                },
                {
                    src: s`${rootDir}/manifest`,
                    dest: s`manifest`
                },
                {
                    src: s`${rootDir}/source/lib.brs`,
                    dest: s`source/lib.brs`
                },
                {
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('uses the root of staging folder for dest when not specified with star star', async () => {
                writeFiles(otherProjectDir, [
                    'components/component1/subComponent/screen.brs',
                    'manifest',
                    'source/thirdPartyLib.brs'
                ]);
                expect(await getFilePaths([{
                    src: `${otherProjectDir}/**/*`
                }])).to.eql([{
                    src: s`${otherProjectDir}/components/component1/subComponent/screen.brs`,
                    dest: s`components/component1/subComponent/screen.brs`
                }, {
                    src: s`${otherProjectDir}/manifest`,
                    dest: s`manifest`
                }, {
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`source/thirdPartyLib.brs`
                }]);
            });

            it('copies absolute path files to specified dest', async () => {
                writeFiles(otherProjectDir, [
                    'source/thirdPartyLib.brs'
                ]);
                expect(await getFilePaths([{
                    src: `${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: 'lib/thirdPartyLib.brs'
                }])).to.eql([{
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`lib/thirdPartyLib.brs`
                }]);
            });

            it('copies relative path files to specified dest', async () => {
                const rootDirName = path.basename(rootDir);
                writeFiles(rootDir, [
                    'source/main.brs'
                ]);
                expect(await getFilePaths([{
                    src: `../${rootDirName}/source/main.brs`,
                    dest: 'source/main.brs'
                }])).to.eql([{
                    src: s`${rootDir}/source/main.brs`,
                    dest: s`source/main.brs`
                }]);
            });

            it('maintains relative path after **', async () => {
                writeFiles(otherProjectDir, [
                    'components/component1/subComponent/screen.brs',
                    'manifest',
                    'source/thirdPartyLib.brs'
                ]);
                expect(await getFilePaths([{
                    src: `../otherProject/**/*`,
                    dest: 'outFolder/'
                }])).to.eql([{
                    src: s`${otherProjectDir}/components/component1/subComponent/screen.brs`,
                    dest: s`outFolder/components/component1/subComponent/screen.brs`
                }, {
                    src: s`${otherProjectDir}/manifest`,
                    dest: s`outFolder/manifest`
                }, {
                    src: s`${otherProjectDir}/source/thirdPartyLib.brs`,
                    dest: s`outFolder/source/thirdPartyLib.brs`
                }]);
            });

            it('works for other globs', async () => {
                expect(await getFilePaths([{
                    src: `components/screen1/*creen1.brs`,
                    dest: s`/source`
                }])).to.eql([{
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`source/screen1.brs`
                }]);
            });

            it('applies negated patterns', async () => {
                writeFiles(rootDir, [
                    'components/component1.brs',
                    'components/component1.xml',
                    'components/screen1/screen1.brs',
                    'components/screen1/screen1.xml'
                ]);
                expect(await getFilePaths([
                    //include all component brs files
                    'components/**/*.brs',
                    //exclude all xml files
                    '!components/**/*.xml',
                    //re-include a specific xml file
                    'components/screen1/screen1.xml'
                ])).to.eql([{
                    src: s`${rootDir}/components/component1.brs`,
                    dest: s`components/component1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.brs`,
                    dest: s`components/screen1/screen1.brs`
                }, {
                    src: s`${rootDir}/components/screen1/screen1.xml`,
                    dest: s`components/screen1/screen1.xml`
                }]);
            });
        });

        it('converts relative rootDir path to absolute', async () => {
            let stub = sinon.stub(rokuDeploy, 'getOptions').callThrough();
            await getFilePaths([
                'source/main.brs'
            ], './rootDir');
            expect(stub.callCount).to.be.greaterThan(0);
            expect(stub.getCall(0).args[0].rootDir).to.eql('./rootDir');
            expect(stub.getCall(0).returnValue.rootDir).to.eql(s`${cwd}/rootDir`);
        });

        it('works when using a different current working directory than rootDir', async () => {
            writeFiles(rootDir, [
                'manifest',
                'images/splash_hd.jpg'
            ]);
            //sanity check, make sure it works without fiddling with cwd intact
            let paths = await getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ]);

            expect(paths).to.eql([{
                src: s`${rootDir}/images/splash_hd.jpg`,
                dest: s`images/splash_hd.jpg`
            }, {
                src: s`${rootDir}/manifest`,
                dest: s`manifest`
            }]);

            //change the working directory and verify everything still works

            let wrongCwd = path.dirname(path.resolve(options.rootDir));
            process.chdir(wrongCwd);

            paths = await getFilePaths([
                'manifest',
                'images/splash_hd.jpg'
            ]);

            expect(paths).to.eql([{
                src: s`${rootDir}/images/splash_hd.jpg`,
                dest: s`images/splash_hd.jpg`
            }, {
                src: s`${rootDir}/manifest`,
                dest: s`manifest`
            }]);
        });

        it('supports absolute paths from outside of the rootDir', async () => {
            //dest not specified
            expect(await getFilePaths([{
                src: sp`${cwd}/README.md`
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`README.md`
            }]);

            //dest specified
            expect(await getFilePaths([{
                src: sp`${cwd}/README.md`,
                dest: 'docs/README.md'
            }], options.rootDir)).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            let paths: any[];

            paths = await getFilePaths([{
                src: sp`${cwd}/README.md`,
                dest: s`docs/README.md`
            }], outDir);

            expect(paths).to.eql([{
                src: s`${cwd}/README.md`,
                dest: s`docs/README.md`
            }]);

            //top-level string paths pointing to files outside the root should thrown an exception
            await expectThrowsAsync(async () => {
                paths = await getFilePaths([
                    sp`${cwd}/README.md`
                ], outDir);
            });
        });

        it('supports relative paths that grab files from outside of the rootDir', async () => {
            writeFiles(`${rootDir}/../`, [
                'README.md'
            ]);
            expect(
                await getFilePaths([{
                    src: sp`../README.md`
                }], rootDir)
            ).to.eql([{
                src: s`${rootDir}/../README.md`,
                dest: s`README.md`
            }]);

            expect(
                await getFilePaths([{
                    src: sp`../README.md`,
                    dest: 'docs/README.md'
                }], rootDir)
            ).to.eql([{
                src: s`${rootDir}/../README.md`,
                dest: s`docs/README.md`
            }]);
        });

        it('should throw exception because we cannot have top-level string paths pointed to files outside the root', async () => {
            writeFiles(rootDir, [
                '../README.md'
            ]);
            await expectThrowsAsync(
                getFilePaths([
                    path.posix.join('..', 'README.md')
                ], outDir)
            );
        });

        it('supports overriding paths', async () => {
            let paths = await getFilePaths([{
                src: sp`${rootDir}/components/component1.brs`,
                dest: 'comp1.brs'
            }, {
                src: sp`${rootDir}/components/screen1/screen1.brs`,
                dest: 'comp1.brs'
            }], rootDir);
            expect(paths).to.be.lengthOf(1);
            expect(s`${paths[0].src}`).to.equal(s`${rootDir}/components/screen1/screen1.brs`);
        });

        it('supports overriding paths from outside the root dir', async () => {
            let thisRootDir = s`${tempDir}/tempTestOverrides/src`;
            try {

                fsExtra.ensureDirSync(s`${thisRootDir}/source`);
                fsExtra.ensureDirSync(s`${thisRootDir}/components`);
                fsExtra.ensureDirSync(s`${thisRootDir}/../.tmp`);

                fsExtra.writeFileSync(s`${thisRootDir}/source/main.brs`, '');
                fsExtra.writeFileSync(s`${thisRootDir}/components/MainScene.brs`, '');
                fsExtra.writeFileSync(s`${thisRootDir}/components/MainScene.xml`, '');
                fsExtra.writeFileSync(s`${thisRootDir}/../.tmp/MainScene.brs`, '');

                let files = [
                    '**/*.xml',
                    '**/*.brs',
                    {
                        src: '../.tmp/MainScene.brs',
                        dest: 'components/MainScene.brs'
                    }
                ];
                let paths = await getFilePaths(files, thisRootDir);

                //the MainScene.brs file from source should NOT be included
                let mainSceneEntries = paths.filter(x => s`${x.dest}` === s`components/MainScene.brs`);
                expect(
                    mainSceneEntries,
                    `Should only be one files entry for 'components/MainScene.brs'`
                ).to.be.lengthOf(1);
                expect(s`${mainSceneEntries[0].src}`).to.eql(s`${thisRootDir}/../.tmp/MainScene.brs`);
            } finally {
                //clean up
                await fsExtra.remove(s`${thisRootDir}/../`);
            }
        });

        it('maintains original file path', async () => {
            fsExtra.outputFileSync(`${rootDir}/components/CustomButton.brs`, '');
            expect(
                await getFilePaths([
                    'components/CustomButton.brs'
                ], rootDir)
            ).to.eql([{
                src: s`${rootDir}/components/CustomButton.brs`,
                dest: s`components/CustomButton.brs`
            }]);
        });

        it('correctly assumes file path if not given', async () => {
            fsExtra.outputFileSync(`${rootDir}/components/CustomButton.brs`, '');
            expect(
                (await getFilePaths([
                    { src: 'components/*' }
                ], rootDir)).sort((a, b) => a.src.localeCompare(b.src))
            ).to.eql([{
                src: s`${rootDir}/components/component1.brs`,
                dest: s`components/component1.brs`
            }, {
                src: s`${rootDir}/components/component1.xml`,
                dest: s`components/component1.xml`
            }, {
                src: s`${rootDir}/components/CustomButton.brs`,
                dest: s`components/CustomButton.brs`
            }]);
        });
    });

    describe('getOptionsFromJson', () => {
        beforeEach(() => {
            fsExtra.ensureDirSync(rootDir);
            process.chdir(rootDir);
        });
        it('should fill in missing options from rokudeploy.json', () => {
            fsExtra.writeJsonSync(s`${rootDir}/rokudeploy.json`, { password: 'password' });
            let options = util.getOptionsFromJson({
                rootDir: `${rootDir}`,
                host: '1.2.3.4'
            });
            let expectedOutput = {
                rootDir: `${rootDir}`,
                host: '1.2.3.4',
                password: 'password'
            };
            expect(options).to.eql(expectedOutput);
        });

        it('should fill in missing default options from bsconfig.json', () => {
            fsExtra.writeJsonSync(s`${rootDir}/bsconfig.json`, { password: 'password' });
            let options = util.getOptionsFromJson({
                rootDir: `${rootDir}`,
                host: '1.2.3.4'
            });
            let expectedOutput = {
                rootDir: `${rootDir}`,
                host: '1.2.3.4',
                password: 'password'
            };
            expect(options).to.eql(expectedOutput);

        });

        it('should not replace default options', () => {
            fsExtra.writeJsonSync(s`${rootDir}/rokudeploy.json`, { host: '4.3.2.1' });
            let options = util.getOptionsFromJson({
                rootDir: `${rootDir}`,
                host: '1.2.3.4'
            });
            let expectedOutput = {
                rootDir: `${rootDir}`,
                host: '1.2.3.4',
            };
            expect(options).to.eql(expectedOutput);

        });
    });
});
