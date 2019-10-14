import { util } from './util';
import { expect } from 'chai';

describe('util', () => {
    describe('isChildOfPath', () => {
        it('works for child path', () => {
            let parentPath = 'C:\\projects\\SomeProject';
            let childPath = 'C:\\projects\\SomeProject\\SomeFile.txt';
            expect(util.isParentOfPath(parentPath, childPath), `expected '${childPath}' to be child path of '${parentPath}'`).to.be.true;
            //inverse is not true
            expect(util.isParentOfPath(childPath, parentPath), `expected '${parentPath}' NOT to be child path of '${childPath}'`).to.be.false;
        });

        it('handles mixed path separators', () => {
            expect(util.isParentOfPath('C:\\projects/SomeProject', 'C:/projects\\SomeProject/SomeFile.txt')).to.be.true;
        });

        it('handles relative path traversals', () => {
            expect(util.isParentOfPath('C:/projects/SomeProject', 'C:/projects/SomeProject/../SomeProject/SomeFile.txt')).to.be.true;
        });

        it('works with trailing slashes', () => {
            expect(util.isParentOfPath('C:/projects/SomeProject/', 'C:/projects/SomeProject/SomeFile.txt')).to.be.true;
        });

        it('works with duplicate slashes', () => {
            expect(util.isParentOfPath('C:/projects///SomeProject/', 'C://projects////SomeProject//SomeFile.txt')).to.be.true;
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
            await util.tryRepeatAsync(async () => {
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
                await util.tryRepeatAsync(async () => {
                    throw new Error('test tryRepeatAsync');
                }, 3, 1);
            } catch (e) {
                error = e;
            }
            expect(error).to.exist;
        });
    });
});