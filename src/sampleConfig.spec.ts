import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { parse as parseJsonc } from 'jsonc-parser';
import { rokuDeploy } from './index';
import { standardizePath as s } from './util';
import { tempDir } from './testUtils.spec';
import { sampleConfigPath } from './commands/InitCommand';
import type { RokuDeployConfig } from './RokuDeployConfig';
import type { DeviceRegistryEntry } from './RokuDeployOptions';

//the flat keys the sample is allowed to use, typed against RokuDeployConfig so a renamed or removed
//option fails to compile here before the sample can drift from the real shape
const sampleKeys: Array<keyof RokuDeployConfig> = [
    'device', 'devices', 'rceToken', 'rootDir', 'files', 'stagingDir', 'outFile',
    'convertToSquashfs', 'signingPassword', 'rekeySignedPackage'
];
//the keys a device/registry entry in the sample may use, typed against the real entry interface
const deviceEntryKeys: Array<keyof DeviceRegistryEntry> = ['host', 'password', 'esn', 'id', 'instanceUrl', 'rceToken'];

/**
 * The sample lists its values but ships most of them commented out (`// "key": value,`), tsc --init
 * style. Strip that leading `// ` so the disabled values parse too and can be checked against the types.
 */
function uncommentOptions(text: string) {
    return text.replace(/^(\s*)\/\/ ?/gm, '$1');
}

describe('src/rokudeploy.sample.jsonc', () => {
    let text: string;
    let live: RokuDeployConfig;
    let full: RokuDeployConfig;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        text = fsExtra.readFileSync(sampleConfigPath).toString();
        live = rokuDeploy.loadConfigFile({ configPath: sampleConfigPath });
        const errors = [];
        full = parseJsonc(uncommentOptions(text), errors, { allowTrailingComma: true });
        expect(errors, 'the sample with every value enabled must still parse').to.eql([]);
    });

    afterEach(() => {
        fsExtra.removeSync(tempDir);
    });

    it('enables nothing out of the box, so a fresh config changes no behavior until edited', () => {
        //everything the sample ships enabled must be blank/default, so loading it is a no-op
        expect(live.device).to.eql({ host: '', password: '' });
        expect(live.rootDir).to.equal('./');
        //nothing else is enabled
        const enabledKeys = Object.keys(live).filter(key => !['device', 'rootDir', 'files'].includes(key));
        expect(enabledKeys).to.eql([]);
    });

    it('uses only keys that exist on RokuDeployConfig', () => {
        const unknown = Object.keys(full).filter(key => !(sampleKeys as string[]).includes(key));
        expect(unknown).to.eql([]);
    });

    it('uses only device keys that exist on the device entry type', () => {
        const entries = [full.device as unknown as Record<string, unknown>, ...Object.values(full.devices ?? {})];
        for (const entry of entries) {
            const unknown = Object.keys(entry).filter(key => !(deviceEntryKeys as string[]).includes(key));
            expect(unknown, `device entry ${JSON.stringify(entry)}`).to.eql([]);
        }
    });

    it('leaves every secret and account-specific identifier blank rather than showing a placeholder', () => {
        const blanks = ['password', 'rceToken', 'signingPassword', 'rekeySignedPackage'];
        for (const key of blanks) {
            //capture just the quoted value, so an inline `{ ..., "password": "" }` is read correctly
            const values = [...text.matchAll(new RegExp(`"${key}": "([^"]*)"`, 'g'))].map(match => match[1]);
            expect(values, key).to.not.be.empty;
            expect(values.every(value => value === ''), `${key} values: ${values.map(v => `"${v}"`).join(', ')}`).to.equal(true);
        }
    });

    //line-based checks split on \r?\n: a Windows checkout with autocrlf hands us CRLF text
    it('keeps every scalar value on a single line so it can be enabled by deleting the leading slashes', () => {
        //a multi-line commented-out value would not survive uncommentOptions(), so guard the format itself
        const commentedOpeners = text.split(/\r?\n/).filter(line => /^\s*\/\/ "[^"]+":.*[[{]\s*$/.test(line) && !/\].*\/\*/.test(line));
        //the only multi-line commented blocks allowed are "devices" and "files" (whole-object examples)
        const allowed = commentedOpeners.filter(line => !/"(devices)":/.test(line));
        expect(allowed).to.eql([]);
    });

    it('aligns every description comment to the same column', () => {
        const columns = new Set(
            text.split(/\r?\n/)
                .map(line => /^(.*?\S)\s{2,}\/\* .* \*\/$/.exec(line))
                .filter(match => match && !match[1].trim().startsWith('/*'))
                //lastIndexOf: glob values like "**/*.*" contain "/*" too
                .map(match => match[0].lastIndexOf('/*'))
        );
        expect([...columns], 'description comments start at more than one column').to.have.lengthOf(1);
    });

    it('loads every value at the top level once enabled, with no nesting by command', () => {
        const enabledPath = s`${tempDir}/rokudeploy.json`;
        fsExtra.outputFileSync(enabledPath, uncommentOptions(text));
        const config = rokuDeploy.loadConfigFile({ configPath: enabledPath });
        expect(config.rootDir).to.equal('./');
        expect(config.outFile).to.equal('roku-deploy');
        expect(config.convertToSquashfs).to.equal(false);
    });
});
