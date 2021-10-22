import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { standardizePath as s } from './util';

export const cwd = process.cwd();
export const tempDir = s`${cwd}/.tmp`;
export const rootDir = s`${tempDir}/rootDir`;
export const outDir = s`${tempDir}/outDir`;
export const stagingDir = s`${outDir}/.roku-deploy-staging`;

export function expectPathExists(thePath: string) {
    expect(
        fsExtra.pathExistsSync(thePath),
        `Expected "${thePath}" to exist`
    ).to.be.true;
}
export function expectPathNotExists(thePath: string) {
    expect(
        fsExtra.pathExistsSync(thePath),
        `Expected "${thePath}" not to exist`
    ).to.be.false;
}

export function writeFiles(baseDir: string, files: Array<string | [string, string]>) {
    const filePaths = [];
    for (let entry of files) {
        if (typeof entry === 'string') {
            entry = [entry] as any;
        }
        let [filePath, contents] = entry as any;
        filePaths.push(filePath);
        filePath = path.resolve(baseDir, filePath);
        fsExtra.outputFileSync(filePath, contents ?? '');
    }
    return filePaths;
}

export async function expectThrowsAsync(callback: Promise<any> | (() => Promise<any>), expectedMessage = undefined, failedTestMessage = 'Expected to throw but did not') {
    let wasExceptionThrown = false;
    let promise: Promise<any>;
    if (typeof callback === 'function') {
        promise = callback();
    } else {
        promise = callback;
    }
    try {
        await promise;
    } catch (e) {
        wasExceptionThrown = true;
        if (expectedMessage) {
            expect((e as any).message).to.eql(expectedMessage);
        }
    }
    if (wasExceptionThrown === false) {
        throw new Error(failedTestMessage);
    }
}
