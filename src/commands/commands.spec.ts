import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import type { SinonStub } from 'sinon';
import { rokuDeploy } from '../index';
import { expectPathExists, tempDir } from '../testUtils.spec';
import { getConfigOutPath } from './commandUtils';
import { CaptureScreenshotCommand } from './CaptureScreenshotCommand';
import { ConvertToSquashfsCommand } from './ConvertToSquashfsCommand';
import { CreateSignedPackageCommand } from './CreateSignedPackageCommand';
import { DeleteDevChannelCommand } from './DeleteDevChannelCommand';
import { GetDeviceInfoCommand } from './GetDeviceInfoCommand';
import { GetDevIdCommand } from './GetDevIdCommand';
import { KeyDownCommand } from './KeyDownCommand';
import { KeyPressCommand } from './KeyPressCommand';
import { KeyUpCommand } from './KeyUpCommand';
import { RekeyDeviceCommand } from './RekeyDeviceCommand';
import { SendTextCommand } from './SendTextCommand';
import { SideloadCommand } from './SideloadCommand';
import { StageCommand } from './StageCommand';
import { ZipCommand } from './ZipCommand';

const sinon = createSandbox();
const configPath = path.join(tempDir, 'rokudeploy.json');
/**
 * Where a relative path written in the test rokudeploy.json ends up: resolved against the json file's folder
 */
const fromConfigDir = (relativePath: string) => path.resolve(tempDir, relativePath);

/**
 * One library option a command produces, and where it can come from.
 */
interface Field {
    /** The option name the RokuDeploy method receives */
    option: string;
    /** The rokudeploy.json key and value that feed it (omitted for cli-only options) */
    config?: [key: string, value: any];
    /** The cli arg and value that feed it (omitted for config-only options) */
    cli?: [arg: string, value: any];
    /** The option value expected from `config`, when the command transforms it */
    fromConfig?: any;
    /** The option value expected from `cli`, when the command transforms it */
    fromCli?: any;
}

/**
 * An older rokudeploy.json (v3) shape that must still produce a v4 option.
 */
interface Translation {
    name: string;
    config: Record<string, any>;
    option: string;
    expected: any;
}

interface CommandSpec {
    name: string;
    run: (args: Record<string, any>) => Promise<void> | void;
    /** The RokuDeploy method whose options are checked */
    method: string;
    /** Every RokuDeploy method the command may call (all stubbed) */
    stubs: string[];
    /** Cli args the command needs to run at all */
    args?: Record<string, any>;
    /** What the stubbed method resolves (defaults to `{}`) */
    resolves?: any;
    fields: Field[];
    translations: Translation[];
    /** rokudeploy.json values that must NOT reach this command */
    ignoredConfig?: Record<string, any>;
    /**
     * For a multi-step command: every cli flag the command accepts, including the other steps' flags, so the
     * "only its own options" check proves those flags don't leak into this step
     */
    strictWith?: Record<string, any>;
}

const commonOptionNames = ['device', 'devices', 'username', 'password', 'packagePort', 'ecpPort', 'timeout', 'cwd'];

//every flag `sideload` and `package` accept, so each step can be checked to ignore the other steps' flags
const sideloadCli = {
    host: '2.2.2.2', password: 'cli-pass', rekey: true, pkg: 'cli.pkg', signingPassword: 'cli-sign', devId: 'cli-dev',
    zip: './cli.zip', dir: './cli-dir', close: false, appType: 'dcl', remoteDebug: true, remoteDebugConnectEarly: true,
    failOnCompileError: false, deleteDevChannel: false
};
const packageCli = {
    host: '2.2.2.2', password: 'cli-pass', rekey: true, sideload: true, squash: true, pkg: 'cli.pkg', signingPassword: 'cli-sign',
    devId: 'cli-dev', zip: './cli.zip', dir: './cli-dir', close: false, appType: 'dcl', failOnCompileError: false,
    deleteDevChannel: false, appTitle: 'My App', appVersion: '1.0', manifestPath: './manifest', out: './cli.pkg',
    //not a `package` flag: proves a production package is never sideloaded in debug mode
    remoteDebug: true, remoteDebugConnectEarly: true
};

//every command spreads these, so every command is checked against them
const commonFields: Field[] = [
    { option: 'device', config: ['device', { host: '1.1.1.1' }], cli: ['host', '2.2.2.2'], fromCli: { host: '2.2.2.2' } },
    { option: 'devices', config: ['devices', { tv: { host: '1.1.1.1' } }] },
    { option: 'username', config: ['username', 'config-user'], cli: ['username', 'cli-user'] },
    { option: 'password', config: ['password', 'config-pass'], cli: ['password', 'cli-pass'] },
    { option: 'packagePort', config: ['packagePort', 81], cli: ['packagePort', 82] },
    { option: 'ecpPort', config: ['ecpPort', 8061], cli: ['ecpPort', 8062] },
    { option: 'timeout', config: ['timeout', 1000], cli: ['timeout', 2000] },
    //cli only: rokudeploy.json has no cwd (its paths are relative to the json file itself)
    { option: 'cwd', cli: ['cwd', './cli-cwd'] }
];

const commonTranslations: Translation[] = [
    { name: 'translates v3 host into device', config: { host: '3.3.3.3' }, option: 'device', expected: { host: '3.3.3.3' } },
    { name: 'prefers device over v3 host', config: { host: '3.3.3.3', device: { host: '1.1.1.1' } }, option: 'device', expected: { host: '1.1.1.1' } },
    { name: 'translates v3 remotePort into ecpPort', config: { remotePort: 9000 }, option: 'ecpPort', expected: 9000 },
    { name: 'prefers ecpPort over v3 remotePort', config: { remotePort: 9000, ecpPort: 8061 }, option: 'ecpPort', expected: 8061 }
];

//the json key is `rekeySignedPackage`; the cli flag and the library option are `pkg`
const pkgField: Field = { option: 'pkg', config: ['rekeySignedPackage', 'config.pkg'], cli: ['pkg', 'cli.pkg'], fromConfig: fromConfigDir('config.pkg') };
const pkgTranslations: Translation[] = [];

//keys that are deliberately NOT rokudeploy.json keys, so no command may read them from the file
const commonIgnoredConfig = { cwd: './config-cwd', pkg: 'config.pkg' };
const deleteDevChannelField: Field = { option: 'deleteDevChannel', config: ['deleteDevChannel', false], cli: ['deleteDevChannel', true] };
const deleteDevChannelTranslations: Translation[] = [
    { name: 'translates v3 deleteInstalledChannel into deleteDevChannel', config: { deleteInstalledChannel: false }, option: 'deleteDevChannel', expected: false },
    { name: 'prefers deleteDevChannel over v3 deleteInstalledChannel', config: { deleteInstalledChannel: false, deleteDevChannel: true }, option: 'deleteDevChannel', expected: true }
];
//the sideload options `package --sideload` shares with `sideload`
const sharedSideloadFields: Field[] = [
    { option: 'dir', cli: ['dir', './cli-dir'] },
    { option: 'zip', cli: ['zip', './cli.zip'] },
    { option: 'close', cli: ['close', false] },
    { option: 'appType', config: ['appType', 'dcl'], cli: ['appType', 'channel'] },
    { option: 'failOnCompileError', config: ['failOnCompileError', false], cli: ['failOnCompileError', true] },
    deleteDevChannelField,
    { option: 'packageUploadOverrides', config: ['packageUploadOverrides', { route: 'custom' }] }
];
//per-session debugger switches: cli only, never read from rokudeploy.json, and not offered by `package`
const remoteDebugFields: Field[] = [
    { option: 'remoteDebug', cli: ['remoteDebug', true] },
    { option: 'remoteDebugConnectEarly', cli: ['remoteDebugConnectEarly', true] }
];
const outPathTranslations: Translation[] = [
    { name: 'translates v3 outDir alone into out', config: { outDir: './dist' }, option: 'out', expected: path.join(fromConfigDir('./dist'), 'roku-deploy') },
    { name: 'translates v3 outDir + outFile into out', config: { outDir: './dist', outFile: 'app' }, option: 'out', expected: path.join(fromConfigDir('./dist'), 'app') }
];

const specs: CommandSpec[] = [
    {
        name: 'stage',
        run: args => new StageCommand().run(args),
        method: 'stage',
        stubs: ['stage'],
        fields: [
            { option: 'rootDir', config: ['rootDir', './config-src'], cli: ['rootDir', './cli-src'], fromConfig: fromConfigDir('./config-src') },
            //globs stay relative to rootDir, so they are not resolved
            { option: 'files', config: ['files', ['config/**']], cli: ['files', ['cli/**']] },
            { option: 'out', config: ['stagingDir', './config-staging'], cli: ['out', './cli-staging'], fromConfig: fromConfigDir('./config-staging') }
        ],
        translations: [
            { name: 'translates v3 stagingFolderPath into out', config: { stagingFolderPath: './v3-staging' }, option: 'out', expected: fromConfigDir('./v3-staging') },
            { name: 'prefers stagingDir over v3 stagingFolderPath', config: { stagingFolderPath: './v3-staging', stagingDir: './staging' }, option: 'out', expected: fromConfigDir('./staging') }
        ]
    },
    {
        name: 'zip',
        run: args => new ZipCommand().run(args),
        method: 'zip',
        stubs: ['zip'],
        fields: [
            { option: 'dir', config: ['stagingDir', './config-staging'], cli: ['dir', './cli-dir'], fromConfig: fromConfigDir('./config-staging') },
            { option: 'out', config: ['outFile', 'config-app'], cli: ['out', './cli.zip'], fromConfig: path.join('./out', 'config-app') },
            { option: 'files', cli: ['files', ['cli/**']] }
        ],
        translations: [
            { name: 'translates v3 stagingFolderPath into dir', config: { stagingFolderPath: './v3-staging' }, option: 'dir', expected: fromConfigDir('./v3-staging') },
            { name: 'prefers stagingDir over v3 stagingFolderPath', config: { stagingFolderPath: './v3-staging', stagingDir: './staging' }, option: 'dir', expected: fromConfigDir('./staging') },
            ...outPathTranslations
        ],
        //the config `files` array is for staging; zip only takes --files
        ignoredConfig: { files: ['manifest'] }
    },
    {
        name: 'sideload',
        run: args => new SideloadCommand().run(args),
        method: 'sideload',
        stubs: ['sideload', 'rekeyDevice'],
        fields: [...sharedSideloadFields, ...remoteDebugFields],
        translations: deleteDevChannelTranslations,
        ignoredConfig: { rootDir: './src', pkg: 'config.pkg', signingPassword: 'config-sign', remoteDebug: true, remoteDebugConnectEarly: true },
        strictWith: sideloadCli
    },
    {
        name: 'sideload --rekey (rekey step)',
        run: args => new SideloadCommand().run(args),
        method: 'rekeyDevice',
        stubs: ['sideload', 'rekeyDevice'],
        args: { rekey: true },
        fields: [
            pkgField,
            { option: 'signingPassword', config: ['signingPassword', 'config-sign'], cli: ['signingPassword', 'cli-sign'] },
            { option: 'devId', config: ['devId', 'config-dev'], cli: ['devId', 'cli-dev'] }
        ],
        translations: pkgTranslations,
        strictWith: sideloadCli
    },
    {
        name: 'package --rekey (rekey step)',
        run: args => new CreateSignedPackageCommand().run(args),
        method: 'rekeyDevice',
        stubs: ['createSignedPackage', 'convertToSquashfs', 'sideload', 'rekeyDevice'],
        args: { rekey: true },
        fields: [
            pkgField,
            { option: 'signingPassword', config: ['signingPassword', 'config-sign'], cli: ['signingPassword', 'cli-sign'] },
            { option: 'devId', config: ['devId', 'config-dev'], cli: ['devId', 'cli-dev'] }
        ],
        translations: pkgTranslations,
        strictWith: packageCli
    },
    {
        name: 'package --sideload (sideload step)',
        run: args => new CreateSignedPackageCommand().run(args),
        method: 'sideload',
        stubs: ['createSignedPackage', 'convertToSquashfs', 'sideload', 'rekeyDevice'],
        args: { sideload: true },
        fields: sharedSideloadFields,
        ignoredConfig: { remoteDebug: true, remoteDebugConnectEarly: true },
        translations: deleteDevChannelTranslations,
        strictWith: packageCli
    },
    {
        name: 'package (squash step)',
        run: args => new CreateSignedPackageCommand().run(args),
        method: 'convertToSquashfs',
        stubs: ['createSignedPackage', 'convertToSquashfs', 'sideload', 'rekeyDevice'],
        fields: [],
        translations: [],
        strictWith: packageCli
    },
    {
        name: 'package (package step)',
        run: args => new CreateSignedPackageCommand().run(args),
        method: 'createSignedPackage',
        stubs: ['createSignedPackage', 'convertToSquashfs', 'sideload', 'rekeyDevice'],
        fields: [
            { option: 'signingPassword', config: ['signingPassword', 'config-sign'], cli: ['signingPassword', 'cli-sign'] },
            { option: 'devId', config: ['devId', 'config-dev'], cli: ['devId', 'cli-dev'] },
            { option: 'out', config: ['outFile', 'config-app'], cli: ['out', './cli.pkg'], fromConfig: path.join('./out', 'config-app') },
            { option: 'appTitle', cli: ['appTitle', 'My App'] },
            { option: 'appVersion', cli: ['appVersion', '1.0'] },
            { option: 'manifestPath', cli: ['manifestPath', './manifest'] }
        ],
        translations: outPathTranslations,
        ignoredConfig: { pkg: 'config.pkg', appType: 'dcl', deleteDevChannel: false, convertToSquashfs: true },
        strictWith: packageCli
    },
    {
        name: 'rekey',
        run: args => new RekeyDeviceCommand().run(args),
        method: 'rekeyDevice',
        stubs: ['rekeyDevice'],
        fields: [
            pkgField,
            { option: 'signingPassword', config: ['signingPassword', 'config-sign'], cli: ['signingPassword', 'cli-sign'] },
            { option: 'devId', config: ['devId', 'config-dev'], cli: ['devId', 'cli-dev'] }
        ],
        translations: pkgTranslations
    },
    {
        name: 'screenshot',
        run: args => new CaptureScreenshotCommand().run(args),
        method: 'captureScreenshot',
        stubs: ['captureScreenshot'],
        fields: [
            { option: 'screenshotDir', config: ['screenshotDir', './config-shots'], fromConfig: fromConfigDir('./config-shots') },
            { option: 'out', cli: ['out', './cli.jpg'] },
            { option: 'autoExtension', cli: ['autoExtension', true] }
        ],
        translations: [],
        ignoredConfig: { rootDir: './src' }
    },
    { name: 'squash', run: args => new ConvertToSquashfsCommand().run(args), method: 'convertToSquashfs', stubs: ['convertToSquashfs'], fields: [], translations: [] },
    { name: 'deleteDevChannel', run: args => new DeleteDevChannelCommand().run(args), method: 'deleteDevChannel', stubs: ['deleteDevChannel'], fields: [], translations: [] },
    { name: 'getDeviceInfo', run: args => new GetDeviceInfoCommand().run(args), method: 'getDeviceInfo', stubs: ['getDeviceInfo'], resolves: { 'device-id': '1234' }, fields: [], translations: [] },
    { name: 'getDevId', run: args => new GetDevIdCommand().run(args), method: 'getDevId', stubs: ['getDevId'], fields: [], translations: [] },
    { name: 'keyPress', run: args => new KeyPressCommand().run(args), method: 'keyPress', stubs: ['keyPress'], fields: [{ option: 'key', cli: ['key', 'Home'] }], translations: [] },
    { name: 'keyUp', run: args => new KeyUpCommand().run(args), method: 'keyUp', stubs: ['keyUp'], fields: [{ option: 'key', cli: ['key', 'Home'] }], translations: [] },
    { name: 'keyDown', run: args => new KeyDownCommand().run(args), method: 'keyDown', stubs: ['keyDown'], fields: [{ option: 'key', cli: ['key', 'Home'] }], translations: [] },
    { name: 'sendText', run: args => new SendTextCommand().run(args), method: 'sendText', stubs: ['sendText'], fields: [{ option: 'text', cli: ['text', 'hello'] }], translations: [] }
];

describe('commands', () => {
    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        //GetDeviceInfo/GetDevId print their result
        sinon.stub(console, 'log');
    });

    afterEach(() => {
        sinon.restore();
        fsExtra.removeSync(tempDir);
    });

    for (const spec of specs) {
        describe(spec.name, () => {
            const fields = [...commonFields, ...spec.fields];
            const translations = [...commonTranslations, ...spec.translations];
            let stubs: Record<string, SinonStub>;

            beforeEach(() => {
                stubs = {};
                for (const name of spec.stubs) {
                    stubs[name] = sinon.stub(rokuDeploy, name as any).resolves(spec.resolves ?? {});
                }
            });

            /**
             * Run the command (optionally with a rokudeploy.json) and return the options the library method received
             */
            async function run(args: Record<string, any>, config?: Record<string, any>) {
                if (config) {
                    fsExtra.outputJsonSync(configPath, config);
                }
                await spec.run({ config: configPath, ...spec.args, ...args });
                expect(stubs[spec.method].callCount, `${spec.method} call count`).to.equal(1);
                return stubs[spec.method].getCall(0).args[0];
            }

            it('leaves every option unset when neither the cli nor rokudeploy.json supplies it, so the RokuDeploy defaults apply', async () => {
                const options = await run({});
                for (const field of fields) {
                    expect(options[field.option], field.option).to.be.undefined;
                }
            });

            it('ignores rokudeploy.json entirely with --no-config', async () => {
                const config = Object.fromEntries(fields.filter(x => x.config).map(x => x.config));
                const options = await run({ config: false }, config);
                for (const field of fields) {
                    expect(options[field.option], field.option).to.be.undefined;
                }
            });

            for (const field of fields.filter(x => x.config)) {
                const [key, value] = field.config;
                it(`reads ${field.option} from rokudeploy.json "${key}"`, async () => {
                    const options = await run({}, { [key]: value });
                    expect(options[field.option]).to.eql(field.fromConfig ?? value);
                });
            }

            for (const field of fields.filter(x => x.cli)) {
                const [arg, value] = field.cli;
                it(`reads ${field.option} from --${arg}`, async () => {
                    const options = await run({ [arg]: value });
                    expect(options[field.option]).to.eql(field.fromCli ?? value);
                });
            }

            for (const field of fields.filter(x => x.config && x.cli)) {
                const [key, configValue] = field.config;
                const [arg, cliValue] = field.cli;
                it(`lets --${arg} override rokudeploy.json "${key}"`, async () => {
                    const options = await run({ [arg]: cliValue }, { [key]: configValue });
                    expect(options[field.option]).to.eql(field.fromCli ?? cliValue);
                });
            }

            for (const translation of translations) {
                it(translation.name, async () => {
                    const options = await run({}, translation.config);
                    expect(options[translation.option]).to.eql(translation.expected);
                });
            }

            it('receives only the shared options and its own options, whatever other cli args are present', async () => {
                const ownCli = Object.fromEntries(fields.filter(x => x.cli).map(x => x.cli));
                const ownConfig = Object.fromEntries(fields.filter(x => x.config).map(x => x.config));
                const options = await run({
                    ...spec.strictWith,
                    ...ownCli,
                    //flags no command reads, plus yargs bookkeeping
                    notAnOption: 'x',
                    'kebab-case': 'x',
                    _: ['cmd'],
                    $0: 'roku-deploy',
                    logLevel: 'info'
                }, ownConfig);
                const allowed = [...commonOptionNames, ...fields.map(x => x.option)];
                expect(Object.keys(options).filter(key => !allowed.includes(key))).to.eql([]);
            });

            const ignoredConfig = { ...commonIgnoredConfig, ...spec.ignoredConfig };
            it(`does not read non-json or unrelated keys from rokudeploy.json (${Object.keys(ignoredConfig).join(', ')})`, async () => {
                const options = await run({}, ignoredConfig);
                for (const key of Object.keys(ignoredConfig)) {
                    expect(options[key], key).to.be.undefined;
                }
            });
        });
    }

    describe('RokuDeploy defaults, end to end (nothing stubbed)', () => {
        const srcDir = path.join(tempDir, 'src');

        beforeEach(() => {
            fsExtra.outputFileSync(path.join(srcDir, 'manifest'), 'title=test');
        });

        it('zip writes to the library default ./out/roku-deploy.zip', async () => {
            await new ZipCommand().run({ config: false, cwd: tempDir, dir: srcDir });
            expectPathExists(path.join(tempDir, 'out', 'roku-deploy.zip'));
        });

        it('stage writes to the library default ./out/.roku-deploy-staging', async () => {
            await new StageCommand().run({ config: false, cwd: tempDir, rootDir: srcDir });
            expectPathExists(path.join(tempDir, 'out', '.roku-deploy-staging', 'manifest'));
        });
    });

    describe('getConfigOutPath', () => {
        it('builds the out path from outDir and outFile, defaulting whichever is missing', () => {
            expect(getConfigOutPath({})).to.be.undefined;
            expect(getConfigOutPath({ outDir: './dist' })).to.equal(path.join('./dist', 'roku-deploy'));
            expect(getConfigOutPath({ outFile: 'app' })).to.equal(path.join('./out', 'app'));
        });
    });
});
