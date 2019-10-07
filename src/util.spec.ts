import { util } from './util';
import { expect } from 'chai';

describe('util', () => {
    describe('isChildOfPath', () => {
        it('works for child path', () => {
            expect(util.isParentOfPath('C:\\projects\\SomeProject', 'C:\\projects\\SomeProject\\SomeFile.txt')).to.be.true;
            //inverse is not true
            expect(util.isParentOfPath('C:\\projects\\SomeProject\\SomeFile.txt', 'C:\\projects\\SomeProject')).to.be.false;
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
});