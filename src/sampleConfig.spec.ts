import { expect } from 'chai';
import { rokuDeploy } from './index';
import { standardizePath as s } from './util';
import { cwd } from './testUtils.spec';
import { configSectionNames } from './RokuDeployConfig';
import type { ConfigSectionName, RokuDeployConfig, RootConfigOptions, RceStartConfig, RceStopConfig } from './RokuDeployConfig';
import type { CaptureScreenshotOptions, ConvertToSquashfsOptions, CreateSignedPackageOptions, DeleteDevChannelOptions, RekeyDeviceOptions, SideloadOptions, StageOptions, ZipOptions } from './RokuDeploy';

const samplePath = s`${cwd}/docs/rokudeploy.sample.json`;

//every key the sample is allowed to use, per section. Typed against the real option interfaces so
//a renamed or removed option fails to compile here before the sample can drift from the shape
const rootKeys: Array<keyof RootConfigOptions> = ['device', 'devices', 'username', 'password', 'packagePort', 'ecpPort', 'timeout', 'rceToken', 'cwd', 'logLevel'];
function keysOf<T>(...keys: Array<keyof T & string>): string[] {
    return keys;
}
const sectionKeys: Record<ConfigSectionName, string[]> = {
    stage: keysOf<StageOptions>('rootDir', 'out', 'files', 'cwd'),
    zip: keysOf<ZipOptions>('dir', 'out', 'files', 'cwd'),
    sideload: keysOf<SideloadOptions>('zip', 'dir', 'appType', 'remoteDebug', 'failOnCompileError', 'deleteDevChannel', 'device', 'password', 'timeout'),
    squash: keysOf<ConvertToSquashfsOptions>('device', 'devices', 'username', 'password', 'packagePort', 'timeout'),
    rekey: keysOf<RekeyDeviceOptions>('pkg', 'signingPassword', 'devId', 'cwd', 'device', 'password'),
    package: keysOf<CreateSignedPackageOptions>('signingPassword', 'out', 'devId', 'appTitle', 'appVersion', 'manifestPath', 'cwd', 'device', 'password'),
    deleteDevChannel: keysOf<DeleteDevChannelOptions>('device', 'devices', 'username', 'password', 'packagePort', 'timeout'),
    screenshot: keysOf<CaptureScreenshotOptions>('out', 'screenshotDir', 'autoExtension', 'cwd', 'device', 'password'),
    'rce.start': keysOf<RceStartConfig>('token', 'deviceId', 'esn', 'snapshot', 'snapshotId', 'firmwareVersionId', 'maxRuntime', 'wait', 'timeout'),
    'rce.stop': keysOf<RceStopConfig>('token', 'deviceId', 'esn', 'wait', 'timeout')
};

describe('docs/rokudeploy.sample.json', () => {
    let config: RokuDeployConfig;

    beforeEach(() => {
        config = rokuDeploy.loadConfigFile({ configPath: samplePath });
    });

    it('parses as jsonc into a non-empty config', () => {
        expect(Object.keys(config).length).to.be.greaterThan(0);
    });

    it('has an object for every recognized command section', () => {
        for (const name of configSectionNames) {
            expect(config[name], `section '${name}'`).to.be.an('object');
        }
    });

    it('uses only root-level keys that exist on RokuDeployConfig', () => {
        const unknown = Object.keys(config)
            .filter(key => !(configSectionNames as readonly string[]).includes(key))
            .filter(key => !(rootKeys as string[]).includes(key));
        expect(unknown).to.eql([]);
    });

    it('uses only keys that exist on each section\'s options type', () => {
        for (const name of configSectionNames) {
            const unknown = Object.keys(config[name]).filter(key => !sectionKeys[name].includes(key));
            expect(unknown, `section '${name}'`).to.eql([]);
        }
    });

    it('names every device it targets in the devices registry', () => {
        const names = Object.keys(config.devices);
        expect(names).to.include(config.device as string);
        for (const name of configSectionNames) {
            const device = (config[name] as { device?: unknown }).device;
            if (typeof device === 'string') {
                expect(names, `section '${name}'`).to.include(device);
            }
        }
    });

    it('flattens a section over the root when loaded for one command', () => {
        const stage = rokuDeploy.loadConfigFile({ configPath: samplePath, section: 'stage' });
        expect(stage.out).to.equal(config.stage.out);
        expect(stage.password).to.equal(config.password);
        expect(stage).not.to.have.property('zip');
    });
});
