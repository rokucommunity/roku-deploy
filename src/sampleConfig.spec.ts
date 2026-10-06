import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { parse as parseJsonc } from 'jsonc-parser';
import { rokuDeploy } from './index';
import { standardizePath as s } from './util';
import { tempDir } from './testUtils.spec';
import { sampleConfigPath } from './commands/InitCommand';
import { configSectionNames } from './RokuDeployConfig';
import type { ConfigSectionName, RokuDeployConfig, RootConfigOptions, RceStartConfig, RceStopConfig } from './RokuDeployConfig';
import type { CaptureScreenshotOptions, ConvertToSquashfsOptions, CreateSignedPackageOptions, DeleteDevChannelOptions, RekeyDeviceOptions, SideloadOptions, StageOptions, ZipOptions } from './RokuDeploy';

//every key the sample may use, per section, typed against the real option interfaces so a renamed or removed
//option fails to compile here before the sample can drift from the shape
const rootKeys: Array<keyof RootConfigOptions> = ['device', 'devices', 'username', 'password', 'packagePort', 'ecpPort', 'timeout', 'rceToken', 'cwd', 'logLevel'];
function keysOf<T>(...keys: Array<keyof T & string>): string[] {
    return keys;
}
const sectionKeys: Record<ConfigSectionName, string[]> = {
    stage: keysOf<StageOptions>('rootDir', 'out', 'files', 'cwd'),
    zip: keysOf<ZipOptions>('dir', 'out', 'files', 'cwd'),
    sideload: keysOf<SideloadOptions>('zip', 'dir', 'appType', 'close', 'remoteDebug', 'remoteDebugConnectEarly', 'failOnCompileError', 'deleteDevChannel', 'device', 'password', 'timeout'),
    squash: keysOf<ConvertToSquashfsOptions>('device', 'timeout'),
    rekey: keysOf<RekeyDeviceOptions>('pkg', 'signingPassword', 'devId', 'cwd'),
    package: keysOf<CreateSignedPackageOptions>('signingPassword', 'out', 'devId', 'appTitle', 'appVersion', 'manifestPath', 'cwd'),
    deleteDevChannel: keysOf<DeleteDevChannelOptions>('device', 'timeout'),
    screenshot: keysOf<CaptureScreenshotOptions>('out', 'screenshotDir', 'autoExtension', 'cwd'),
    'rce.start': keysOf<RceStartConfig>('token', 'deviceId', 'esn', 'snapshot', 'snapshotId', 'firmwareVersionId', 'maxRuntime', 'wait', 'timeout'),
    'rce.stop': keysOf<RceStopConfig>('token', 'deviceId', 'esn', 'wait', 'timeout')
};

/**
 * The sample lists every option but ships most of them commented out (`// "key": value,`), tsc --init style.
 * Strip that leading `// ` so the disabled options are parsed too and can be checked against the types.
 */
function uncommentOptions(text: string) {
    return text.replace(/^(\s*)\/\/ ("[^"]+":)/gm, '$1$2');
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
        expect(errors, 'the sample with every option enabled must still parse').to.eql([]);
    });

    afterEach(() => {
        fsExtra.removeSync(tempDir);
    });

    it('enables nothing out of the box, so a fresh config changes no behavior until edited', () => {
        const liveKeys = Object.keys(live).filter(key => !(configSectionNames as readonly string[]).includes(key));
        expect(liveKeys).to.eql([]);
        for (const name of configSectionNames) {
            expect(live[name], `section '${name}'`).to.eql({});
        }
    });

    it('leaves every secret and account-specific identifier blank rather than showing a placeholder', () => {
        const blanks: Record<string, string> = {
            password: '""', signingPassword: '""', rceToken: '""', token: '""', esn: '""', devId: '""',
            deviceId: '0', snapshotId: '0'
        };
        for (const [key, blank] of Object.entries(blanks)) {
            const values = [...text.matchAll(new RegExp(`"${key}": ([^,]*),`, 'g'))].map(match => match[1]);
            expect(values, key).to.not.be.empty;
            expect(values.every(value => value === blank), `${key} values: ${values.join(', ')}`).to.equal(true);
        }
    });

    it('has a section object for every recognized command section', () => {
        for (const name of configSectionNames) {
            expect(live[name], `section '${name}'`).to.be.an('object');
        }
    });

    it('uses only root-level keys that exist on RokuDeployConfig', () => {
        const unknown = Object.keys(full)
            .filter(key => !(configSectionNames as readonly string[]).includes(key))
            .filter(key => !(rootKeys as string[]).includes(key));
        expect(unknown).to.eql([]);
    });

    it('uses only keys that exist on each section\'s options type', () => {
        for (const name of configSectionNames) {
            const unknown = Object.keys(full[name]).filter(key => !sectionKeys[name].includes(key));
            expect(unknown, `section '${name}'`).to.eql([]);
        }
    });

    it('lists every root-level option, enabled or commented out', () => {
        const missing = rootKeys.filter(key => !(key in full));
        expect(missing).to.eql([]);
    });

    it('lists every option of every section, enabled or commented out', () => {
        for (const name of configSectionNames) {
            const section = full[name];
            const missing = sectionKeys[name].filter(key => !(key in section));
            expect(missing, `section '${name}'`).to.eql([]);
        }
    });

    //line-based checks split on \r?\n: a Windows checkout with autocrlf hands us CRLF text
    it('keeps every option on a single line so it can be enabled by deleting the leading slashes', () => {
        //a multi-line commented-out value would not survive uncommentOptions(), so guard the format itself
        const commentedOpeners = text.split(/\r?\n/).filter(line => /^\s*\/\/ "[^"]+":.*[[{]\s*$/.test(line));
        expect(commentedOpeners).to.eql([]);
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

    it('flattens a section over the root once the options are enabled', () => {
        //write the fully-enabled variant to disk and load it the way the CLI would
        const enabledPath = s`${tempDir}/rokudeploy.json`;
        fsExtra.outputFileSync(enabledPath, uncommentOptions(text));
        const sideload = rokuDeploy.loadConfigFile({ configPath: enabledPath, section: 'sideload' });
        expect(sideload.dir).to.equal('./');
        expect(sideload.ecpPort).to.equal(8060);
        expect(sideload).not.to.have.property('stage');
    });
});
