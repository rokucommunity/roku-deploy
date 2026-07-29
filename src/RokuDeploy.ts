import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { WriteStream, ReadStream } from 'fs-extra';
import { request } from './request';
import type { RequestOptions } from './request';
import * as JSZip from 'jszip';
import {
    CompileError,
    ConnectionResetError,
    ConvertError,
    DeviceUnreachableError,
    EcpNetworkAccessModeDisabledError,
    extractHttpDetails,
    FailedDeviceResponseError,
    InvalidDeviceResponseCodeError,
    InvalidOptionError,
    UnauthorizedDeviceResponseError,
    UnknownDeviceResponseError,
    UnparsableDeviceResponseError,
    UnsupportedFirmwareVersionError,
    UpdateCheckRequiredError
} from './Errors';
import * as xml2js from 'xml2js';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { util } from './util';
import type { DeviceRegistryEntry, FileEntry, RokuDeployConstructorOptions, RokuDeployOptions } from './RokuDeployOptions';
import { isRceDeviceConfig, isRceById, isRceByUrl } from './DeviceConfig';
import type { DeviceConfig, DeviceOption, RceDeviceConfig } from './DeviceConfig';
import { RceDevice } from './RceDevice';
import { logger } from '@rokucommunity/logger';
import type { DeviceInfo, DeviceInfoRaw } from './DeviceInfo';
import * as semver from 'semver';
import { fetchWithDigest } from './fetch';
import { formatTimestampForScreenshot } from './dateUtils';

export const DefaultFiles = [
    'source/**/*.*',
    'components/**/*.*',
    'images/**/*.*',
    'locale/**/*',
    'fonts/**/*',
    'manifest',
    '!node_modules',
    '!**/*.{md,DS_Store,db}'
];

export class RokuDeploy {
    /**
     * Default values for common options used across multiple functions.
     * Public so consumers can resolve the same defaults roku-deploy uses internally
     * instead of hardcoding them (see also `getStagingDir`, `getOutputZipPath` and `getOutputPkgPath`).
     */
    public static readonly defaults = {
        timeout: 150000,
        /**
         * The default timeout for ECP requests, in milliseconds. ECP commands are small and fast,
         * so this is much lower than `timeout` (which must accommodate large installer uploads).
         */
        ecpTimeout: 10000,
        packagePort: 80,
        ecpPort: 8060,
        username: 'rokudev',
        outDir: './out',
        outFile: 'roku-deploy.zip',
        /**
         * The name of the staging folder that gets created inside `outDir`
         */
        stagingDirName: '.roku-deploy-staging',
        files: DefaultFiles
    };

    /**
     * The minimum zip size (in bytes) the Roku firmware will sideload. A zip smaller than this is rejected
     * with "Install Failure: Unzip failed. Invalid or corrupt zip archive." (observed on firmware 15.x for
     * both channels and component libraries).
     */
    public static readonly MINIMUM_INSTALLABLE_ZIP_SIZE = 512;

    /**
     * Load options from a rokudeploy.json file. Used by CLI commands to load configuration.
     */
    public loadConfigFile(options?: LoadConfigFileOptions): RokuDeployOptions {
        const cwd = options?.cwd ?? process.cwd();
        const configPath = options?.configPath ?? path.join(cwd, 'rokudeploy.json');

        if (fsExtra.existsSync(configPath)) {
            const configFileText = fsExtra.readFileSync(configPath).toString();
            const parseErrors: ParseError[] = [];
            const fileOptions = parseJsonc(configFileText, parseErrors, {
                allowEmptyContent: true,
                allowTrailingComma: true,
                disallowComments: false
            });
            if (parseErrors.length > 0) {
                throw new Error(`Error parsing "${path.resolve(configPath)}": ` + JSON.stringify(
                    parseErrors.map(x => {
                        return {
                            message: printParseErrorCode(x.error),
                            offset: x.offset,
                            length: x.length
                        };
                    })
                ));
            }
            return fileOptions;
        }
        return {};
    }

    /**
     * Instance-level default options merged into every method call
     */
    private readonly options: RokuDeployConstructorOptions;

    /**
     * The logger instance for this RokuDeploy instance
     */
    public readonly logger: typeof logger;

    /**
     * One `RceDevice` per unique RCE device config, cached for the lifetime of this `RokuDeploy` instance.
     * `RceDevice` itself memoizes the resolved instance url, so reusing the same instance across a
     * multi-request flow (for example sideload's closeChannel -> deleteDevChannel -> plugin_install) avoids
     * re-resolving the instance url through the management api on every request.
     */
    private readonly rceDevicesByCacheKey = new Map<string, RceDevice>();

    /**
     * Create a new RokuDeploy instance with optional default options
     */
    constructor(options?: RokuDeployConstructorOptions) {
        this.options = options ?? {};

        // Use custom logger if provided, otherwise use global logger
        this.logger = this.options.logger ?? logger;
    }

    /**
     * Copies all of the referenced files to the staging folder
     * @param options
     */
    /**
     * Resolve the path to the staging folder the same way `stage` does: `out` wins when provided,
     * otherwise the default staging folder inside `outDir`.
     */
    public getStagingDir(options?: GetStagingDirOptions): string {
        const cwd = options?.cwd ?? process.cwd();
        return options?.out
            ? path.resolve(cwd, options.out)
            : path.resolve(cwd, options?.outDir ?? RokuDeploy.defaults.outDir, RokuDeploy.defaults.stagingDirName);
    }

    /**
     * Resolve the path to the output zip file the same way `zip` does: `out` wins when provided,
     * otherwise `outFile` inside `outDir`. Always ends with `.zip`.
     */
    public getOutputZipPath(options?: GetOutputPathOptions): string {
        const cwd = options?.cwd ?? process.cwd();
        let out = options?.out
            ? path.resolve(cwd, options.out)
            : path.resolve(cwd, options?.outDir ?? RokuDeploy.defaults.outDir, options?.outFile ?? RokuDeploy.defaults.outFile);

        // Ensure .zip extension
        if (!out.toLowerCase().endsWith('.zip')) {
            out += '.zip';
        }
        return out;
    }

    /**
     * Resolve the path to the output pkg file the same way `createSignedPackage` does: `out` wins when
     * provided, otherwise `outFile` inside `outDir`. Always ends with `.pkg` (a `.zip` extension is swapped).
     */
    public getOutputPkgPath(options?: GetOutputPathOptions): string {
        const cwd = options?.cwd ?? process.cwd();
        let out = options?.out
            ? path.resolve(cwd, options.out)
            : path.resolve(cwd, options?.outDir ?? RokuDeploy.defaults.outDir, options?.outFile ?? RokuDeploy.defaults.outFile);

        // Ensure .pkg extension
        if (out.toLowerCase().endsWith('.zip')) {
            out = out.replace(/\.zip$/i, '.pkg');
        } else if (!out.toLowerCase().endsWith('.pkg')) {
            out += '.pkg';
        }
        return out;
    }

    public async stage(options: StageOptions): Promise<StageResult> {
        options = { ...this.options, ...options };
        this.logger.info('Beginning to copy files to staging folder');
        const cwd = options.cwd ?? process.cwd();

        // Set defaults and resolve paths
        const rootDir = path.resolve(cwd, options.rootDir ?? './');
        const files = options.files ?? [...DefaultFiles];

        // Resolve output directory - use 'out' if provided, otherwise default to staging dir
        const out = this.getStagingDir({ out: options.out, cwd: cwd });

        //clean the staging directory
        await fsExtra.remove(out);

        //make sure the staging folder exists
        await fsExtra.ensureDir(out);

        if (!await fsExtra.pathExists(rootDir)) {
            throw new Error(`rootDir does not exist at "${rootDir}"`);
        }

        let fileObjects = await this.getFilePaths({ files: files, rootDir: rootDir });
        //copy all of the files
        await Promise.all(fileObjects.map(async (fileObject) => {
            let destFilePath = util.standardizePath(`${out}/${fileObject.dest}`);

            //make sure the containing folder exists
            await fsExtra.ensureDir(path.dirname(destFilePath));

            //sometimes the copyfile action fails due to race conditions (normally to poorly constructed src;dest; objects with duplicate files in them
            await util.tryRepeatAsync(async () => {
                //copy the src item using the filesystem
                await fsExtra.copy(fileObject.src, destFilePath, {
                    //copy the actual files that symlinks point to, not the symlinks themselves
                    dereference: true
                });
            }, 10);
        }));
        this.logger.info('Relevant files copied to:', out);
        return { stagingDir: out };
    }

    /**
     * Given an already-populated staging folder, create a zip archive of it and copy it to the output folder
     * @param options
     */
    public async zip(options: ZipOptions): Promise<ZipResult> {
        options = { ...this.options, ...options };
        logger.info('Beginning to zip');
        const cwd = options.cwd ?? process.cwd();

        // dir is required
        if (!options.dir) {
            throw new Error('"dir" is required for zip');
        }

        const dir = path.resolve(cwd, options.dir);

        // Resolve output zip path - use 'out' if provided, otherwise default
        const out = this.getOutputZipPath({ out: options.out, cwd: cwd });

        // Get files to include - use provided files array or default to everything
        const files = options.files ?? ['**/*'];

        // Check that manifest will be included
        const filePaths = await this.getFilePaths({ files: files, rootDir: dir });
        const hasManifest = filePaths.some(f => f.dest.toLowerCase() === 'manifest');
        if (!hasManifest) {
            throw new Error(`Cannot zip package: missing manifest file in "${dir}"`);
        }

        //create a zip of the folder
        await this.makeZip(dir, out, files);
        this.logger.info('Zip created at:', out);
        return { zipPath: out };
    }

    /**
     * Given a path to a folder, zip up that folder and all of its contents
     * @param srcFolder the folder that should be zipped
     * @param zipFilePath the path to the zip that will be created
     * @param files a files array used to filter the files from `srcFolder`
     */
    private async makeZip(srcFolder: string, zipFilePath: string, files: FileEntry[] = ['**/*']) {
        const filePaths = await this.getFilePaths({ files: files, rootDir: srcFolder });

        const zip = new JSZip();
        // Allows us to wait until all are done before we build the zip
        const promises = [];
        for (const file of filePaths) {
            const promise = fsExtra.readFile(file.src).then((data) => {
                const ext = path.extname(file.dest).toLowerCase();
                let compression: 'DEFLATE' | 'STORE' = 'DEFLATE';

                if (ext === '.jpg' || ext === '.png' || ext === '.jpeg') {
                    compression = 'STORE';
                }
                zip.file(file.dest.replace(/[\\/]/g, '/'), data as Uint8Array, {
                    compression: compression
                });
            });
            promises.push(promise);
        }
        await Promise.all(promises);

        //ensure the output directory exists
        await fsExtra.ensureDir(
            path.dirname(zipFilePath)
        );
        // level 2 compression seems to be the best balance between speed and file size. Speed matters more since most will be calling squashfs afterwards.
        const content = await zip.generateAsync({ type: 'nodebuffer', compressionOptions: { level: 2 } });
        return fsExtra.writeFile(zipFilePath, content);
    }

    /**
    * Get all file paths for the specified options
    */
    public async getFilePaths(options: GetFilePathsOptions): Promise<StandardizedFileEntry[]> {
        options = { ...this.options, ...options } as GetFilePathsOptions;
        let rootDir = options.rootDir;
        const files = options.files;

        //if the rootDir isn't absolute, convert it to absolute
        if (path.isAbsolute(rootDir) === false) {
            rootDir = path.resolve(process.cwd(), rootDir);
        }
        const entries = util.normalizeFilesArray(files);
        const srcPathsByIndex = await util.globAllByIndex(
            entries.map(x => {
                return typeof x === 'string' ? x : x.src;
            }),
            rootDir
        );

        /**
         * Result indexed by the dest path
         */
        let result = new Map<string, StandardizedFileEntry>();

        //compute `dest` path for every file
        for (let i = 0; i < srcPathsByIndex.length; i++) {
            const srcPaths = srcPathsByIndex[i];
            const entry = entries[i];
            if (srcPaths) {
                for (let srcPath of srcPaths) {
                    srcPath = util.standardizePath(srcPath);

                    const dest = util.computeFileDestPath(srcPath, entry, rootDir);
                    //the last file with this `dest` will win, so just replace any existing entry with this one.
                    result.set(dest, {
                        src: srcPath,
                        dest: dest
                    });
                }
            }
        }
        return [...result.values()];
    }

    private async generateBaseRequestOptions<T>(requestPath: string, deviceConfig: DeviceConfig, options: BaseRequestOptions, formData = {} as T): Promise<RequestOptions> {
        // Merge constructor options with call options
        const mergedOptions = { ...this.options, ...options };
        // Set defaults for request options
        const packagePort = mergedOptions.packagePort ?? RokuDeploy.defaults.packagePort;
        const timeout = mergedOptions.timeout ?? RokuDeploy.defaults.timeout;
        const username = mergedOptions.username ?? RokuDeploy.defaults.username;

        const { baseUrl, query } = await this.getInstallerBaseUrl(deviceConfig, packagePort);
        let url = `${baseUrl}/${requestPath}`;
        //append the query string (if any) rather than assuming the base has none, since `requestPath` can
        //itself already carry a query string (for example the screenshot image path returned by the device)
        if (query) {
            url += (url.includes('?') ? '&' : '?') + query;
        }
        let baseRequestOptions = {
            url: url,
            timeout: timeout,
            auth: {
                user: username,
                pass: mergedOptions.password,
                sendImmediately: false
            },
            formData: formData,
            agentOptions: { 'keepAlive': false }
        };
        return baseRequestOptions;
    }

    /**
     * Resolve the installer base url (and any query string that must be appended to every request) for a
     * device config. Local devices hit the classic port-80 dev installer directly; RCE devices are reached
     * through the instance api's `/sideload` proxy, which forwards to the emulated device's installer.
     *
     * The RCE instance api sits behind a service mesh that authenticates via the `access_token` query
     * parameter (rather than the `Authorization` header, which is reserved for the installer's own HTTP
     * Digest challenge) - see the RCE sideload recipe notes for the full explanation of why both auth layers
     * are needed and why they can't share the `Authorization` header.
     */
    private async getInstallerBaseUrl(deviceConfig: DeviceConfig, packagePort: number): Promise<{ baseUrl: string; query: string }> {
        if (!isRceDeviceConfig(deviceConfig)) {
            return {
                baseUrl: `http://${deviceConfig.host}:${packagePort}`,
                query: ''
            };
        }
        if (!deviceConfig.rceToken) {
            throw new Error('An rceToken is required to reach the installer on an RCE device');
        }
        const instanceUrl = await this.getRceDevice(deviceConfig).getInstanceUrl();
        return {
            baseUrl: `${instanceUrl}/sideload`,
            query: `access_token=${deviceConfig.rceToken}`
        };
    }

    /**
     * Resolve the ECP base url (and any query string that must be appended to every request) for a
     * device config. Local devices hit the HTTP ECP port directly; RCE devices are reached through
     * the instance's raw `/ecp1` proxy, which forwards to the emulated device's ECP port and
     * authenticates via the `access_token` query parameter (the same service-mesh auth carrier the
     * installer proxy uses).
     */
    private async getEcpBaseUrl(deviceConfig: DeviceConfig, ecpPort: number): Promise<{ baseUrl: string; query: string }> {
        if (!isRceDeviceConfig(deviceConfig)) {
            let host = this.getHost(deviceConfig);
            //if the host is a DNS name, look up the IP address
            try {
                host = await util.dnsLookup(host);
            } catch (e) {
                //try using the host as-is (it'll probably fail...)
            }
            return {
                baseUrl: `http://${host}:${ecpPort}`,
                query: ''
            };
        }
        if (!deviceConfig.rceToken) {
            throw new Error('An rceToken is required to reach ECP on an RCE device');
        }
        const instanceUrl = await this.getRceDevice(deviceConfig).getInstanceUrl();
        return {
            baseUrl: `${instanceUrl}/ecp1`,
            query: `access_token=${deviceConfig.rceToken}`
        };
    }

    /**
     * Send a raw External Control Protocol (ECP) request to a device and return the response with
     * its XML body parsed to JSON. This is the single ECP transport: every ECP convenience method
     * funnels through it, and it is public so any ECP route can be reached even when no dedicated
     * wrapper exists for it yet.
     *
     * Local devices are addressed as `http://<host>:<ecpPort>/<route>`; Cloud Emulator devices go
     * through their instance's `/ecp1/<route>` proxy (authenticated with the config's api token),
     * so callers never branch on device kind.
     * @param device the device to send the request to
     * @param route the ECP route without a leading slash (for example `query/device-info`, `keypress/Home`)
     * @param options `method` defaults to 'GET' (queries); commands like keypress and launch are POSTs.
     *                `verify` defaults to false so raw ECP status bodies (a 202 `FAILED` registry or
     *                chanperf response, for example) come back to the caller instead of throwing.
     */
    public async ecp(device: DeviceOption, route: string, options?: EcpOptions): Promise<EcpResult> {
        options = { ...this.options, ...options } as EcpOptions;
        this.validatePort(options.ecpPort, 'ecpPort');
        this.validateTimeout(options.timeout);

        const deviceConfig = this.resolveDevice(device);
        const timeout = options.timeout ?? RokuDeploy.defaults.ecpTimeout;
        const ecpPort = options.ecpPort ?? RokuDeploy.defaults.ecpPort;

        const { baseUrl, query } = await this.getEcpBaseUrl(deviceConfig, ecpPort);
        let url = `${baseUrl}/${route}`;
        //append the query string (if any) rather than assuming the route has none, since deep-link
        //launch routes carry their own query params
        if (query) {
            url += (url.includes('?') ? '&' : '?') + query;
        }

        const requestOptions: RequestOptions = { url: url, timeout: timeout };
        const verify = options.verify ?? false;
        const response = options.method === 'POST'
            ? await this.doPostRequest(requestOptions, verify)
            : await this.doGetRequest(requestOptions, verify);

        return {
            status: response?.response?.statusCode,
            body: response?.body,
            json: await this.parseEcpXml(response?.body, response)
        };
    }

    /**
     * Parse an ECP XML response body into a plain object (xml2js, `explicitArray: false`). An empty
     * or non-XML body (commands like keypress return none; a proxy error page is not XML) yields
     * undefined so the caller can inspect the status and raw body instead; a body that looks like
     * XML but cannot be parsed throws.
     */
    private async parseEcpXml(body: string, response?: HttpResponse): Promise<Record<string, any> | undefined> {
        if (typeof body !== 'string' || !body.trim().startsWith('<')) {
            return undefined;
        }
        try {
            const parsedContent = await xml2js.parseStringPromise(body, {
                explicitArray: false
            });
            // clone the data onto an object because xml2js somehow makes this object not an object???
            return { ...parsedContent };
        } catch (e) {
            throw new UnparsableDeviceResponseError('Could not parse ECP response', {
                httpDetails: extractHttpDetails(response?.response, response?.body)
            }, e instanceof Error ? e : undefined);
        }
    }

    /**
     * Get (or create) the `RceDevice` for a given RCE device config. Devices are cached by their
     * identifying fields so repeated calls for the same logical device - even across separately-resolved
     * `DeviceConfig` objects, as happens with registry-name lookups - reuse the same instance and its
     * memoized instance url.
     */
    private getRceDevice(deviceConfig: RceDeviceConfig): RceDevice {
        const cacheKey = this.getRceDeviceCacheKey(deviceConfig);
        let rceDevice = this.rceDevicesByCacheKey.get(cacheKey);
        if (!rceDevice) {
            rceDevice = new RceDevice(deviceConfig);
            this.rceDevicesByCacheKey.set(cacheKey, rceDevice);
        }
        return rceDevice;
    }

    /**
     * Build a stable cache key for an RCE device config from its identifying field (whichever of
     * `instanceUrl`, `id`, or `esn` is present) plus its token, so a differently-tokened config for the
     * same identifier does not reuse another config's cached device.
     */
    private getRceDeviceCacheKey(deviceConfig: RceDeviceConfig): string {
        const token = deviceConfig.rceToken ?? '';
        if (isRceByUrl(deviceConfig)) {
            return `instanceUrl:${deviceConfig.instanceUrl}:${token}`;
        }
        if (isRceById(deviceConfig)) {
            return `id:${deviceConfig.id}:${token}`;
        }
        return `esn:${deviceConfig.esn}:${token}`;
    }

    public async keyPress(options: KeyPressOptions) {
        options = { ...this.options, ...options } as KeyPressOptions;
        return this.sendKeyEvent({
            ...options,
            key: options.key,
            action: 'keypress'
        });
    }

    public async keyUp(options: KeyUpOptions) {
        options = { ...this.options, ...options } as KeyUpOptions;
        return this.sendKeyEvent({
            ...options,
            action: 'keyup'
        });
    }

    public async keyDown(options: KeyDownOptions) {
        options = { ...this.options, ...options } as KeyDownOptions;
        return this.sendKeyEvent({
            ...options,
            action: 'keydown'
        });
    }

    public async sendText(options: SendTextOptions) {
        options = { ...this.options, ...options } as SendTextOptions;
        this.checkRequiredOptions(options, ['device', 'text']);
        const chars = options.text.split('');
        for (const char of chars) {
            await this.sendKeyEvent({
                ...options,
                key: `lit_${encodeURIComponent(char)}`,
                action: 'keypress'
            });
        }
    }

    /**
     * Normalize a key name to its canonical `RemoteKey` casing for the RCE instance-api key-input
     * route, which rejects a wrong-case key with a 422 (the raw ECP proxy and LAN ECP accept any
     * case). A key that matches a `RemoteKey` value case-insensitively is returned in that canonical
     * casing; a literal-text key (`lit_<char>`) becomes `Lit_<char>`; anything else is passed
     * through unchanged (there is no enforced key list, so an unknown key is sent as-is and simply
     * falls back to the raw proxy if the route rejects it).
     */
    private toCanonicalRemoteKey(key: string): string {
        if (/^lit_/i.test(key)) {
            return `Lit_${key.slice(4)}`;
        }
        return Object.values(RemoteKey).find((candidate) => candidate.toLowerCase() === key.toLowerCase()) ?? key;
    }

    /**
     * Send a single key event (keypress/keydown/keyup) to a device.
     *
     * For an RCE device the instance-api key-input route (`/api/v0/ecp1/<action>/<key>`) is tried
     * first: unlike the raw `/ecp1` proxy the generic ecp() transport uses, it keeps working when
     * the device is in limited ECP mode (which 403s every raw-proxy key press). Any failure - a
     * non-2xx response (verify throws), or a future rename of that path - falls through to the
     * normal ecp() transport below, so RCE devices in normal mode and LAN devices are unaffected.
     */
    private async sendKeyEvent(options: SendKeyEventOptions) {
        options = { ...this.options, ...options };
        this.logger.info('Sending key event:', options.key);
        this.checkRequiredOptions(options, ['device', 'key']);

        const deviceConfig = this.resolveDevice(options.device);
        if (isRceDeviceConfig(deviceConfig)) {
            try {
                if (!deviceConfig.rceToken) {
                    throw new Error('An rceToken is required to reach ECP on an RCE device');
                }
                const instanceUrl = await this.getRceDevice(deviceConfig).getInstanceUrl();
                const key = this.toCanonicalRemoteKey(options.key);
                const url = `${instanceUrl}/api/v0/ecp1/${options.action}/${key}?access_token=${deviceConfig.rceToken}`;
                const response = await this.doPostRequest({ url: url, timeout: options.timeout ?? RokuDeploy.defaults.ecpTimeout }, true);
                return {
                    status: response?.response?.statusCode,
                    body: response?.body,
                    json: undefined
                } as EcpResult;
            } catch (e) {
                this.logger.warn('RCE instance-api key route failed; falling back to the ecp1 proxy', this.scrubAccessToken((e as Error)?.message ?? ''));
            }
        }

        return this.ecp(options.device, `${options.action}/${options.key}`, {
            method: 'POST',
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
    }

    public async closeChannel(options: CloseChannelOptions) {
        options = { ...this.options, ...options } as CloseChannelOptions;
        // TODO: After 13.0 releases, add check for ECP close-app support, and use that twice to kill instant resume if available
        await this.sendKeyEvent({
            ...options,
            action: 'keypress',
            key: 'home'
        });
    }

    /**
     * Launch a channel on the device (the ECP `launch/{appId}` endpoint).
     * @param options
     */
    public async launchApp(options: LaunchAppOptions): Promise<void> {
        options = { ...this.options, ...options } as LaunchAppOptions;
        this.checkRequiredOptions(options, ['device', 'appId']);

        const queryString = this.buildLaunchQueryString(options);
        await this.ecp(options.device, `launch/${options.appId}${queryString}`, {
            method: 'POST',
            verify: true,
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
    }

    /**
     * Build the deep-link query string (contentId, mediaType, and any additional params) for a local `launch/{appId}` request.
     * @param options
     */
    private buildLaunchQueryString(options: LaunchAppOptions): string {
        const queryParams: Record<string, string> = { ...options.params };
        if (options.contentId !== undefined) {
            queryParams.contentId = options.contentId;
        }
        if (options.mediaType !== undefined) {
            queryParams.mediaType = options.mediaType;
        }
        const queryEntries = Object.entries(queryParams);
        if (queryEntries.length === 0) {
            return '';
        }
        const serializedParams = queryEntries.map(([paramName, paramValue]) => `${encodeURIComponent(paramName)}=${encodeURIComponent(paramValue)}`).join('&');
        return `?${serializedParams}`;
    }

    /**
     * Exit a running channel on the device (the ECP `exit-app/{appId}` endpoint).
     * @param options
     */
    public async exitApp(options: ExitAppOptions): Promise<void> {
        options = { ...this.options, ...options } as ExitAppOptions;
        this.checkRequiredOptions(options, ['device', 'appId']);

        const forceSegment = options.force ? '/true' : '';
        const result = await this.ecp(options.device, `exit-app/${options.appId}${forceSegment}`, {
            method: 'POST',
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
        //devices report exit-app failures through the ECP envelope (a 202 with the error in the
        //body), so surface that message; fall back to a plain status check when there is no envelope
        const root = result.json?.['exit-app'];
        if (root && typeof root.status === 'string' && root.status.toLowerCase() !== 'ok') {
            throw new FailedDeviceResponseError(`Could not exit app: ${root.error ?? 'Unknown error'}`, {
                httpDetails: extractHttpDetails(undefined, result.body)
            });
        }
        if (!root) {
            this.assertEcpStatusOk(result);
        }
    }

    /**
     * Throw for a non-2xx ECP response, carrying any plain-text device explanation in the message
     * (for example `ECP command not allowed in Limited mode.`). Used by ECP wrappers whose success
     * responses have no `<status>` envelope to inspect instead.
     */
    private assertEcpStatusOk(result: EcpResult): void {
        if (result.status !== undefined && result.status >= 200 && result.status < 300) {
            return;
        }
        const bodyText = typeof result.body === 'string' ? result.body.trim() : '';
        throw new InvalidDeviceResponseCodeError(`Invalid response code: ${result.status ?? 'unknown'}${bodyText ? `: ${bodyText}` : ''}`, {
            httpDetails: extractHttpDetails(undefined, result.body)
        });
    }

    /**
     * Sideload a zip to a remote Roku. Either `zip` (path to a pre-built zip) or `dir` (directory
     * to zip on-the-fly) must be provided.
     * @param options
     */
    public async sideload(options: SideloadOptions): Promise<{ message: string; results: any }> {
        options = { ...this.options, ...options } as SideloadOptions;
        this.logger.info('Beginning to sideload package');
        this.checkRequiredOptions(options, ['device', 'password']);
        this.validatePort(options.packagePort, 'packagePort');
        this.validateTimeout(options.timeout);
        this.validateEnum(options.appType, 'appType', ['channel', 'dcl'] as const);

        const deviceConfig = this.resolveDevice(options.device);

        const cwd = options.cwd ?? process.cwd();
        // Set defaults
        const deleteDevChannel = options.deleteDevChannel ?? true;
        const failOnCompileError = options.failOnCompileError ?? true;

        let zipFilePath: string;
        let deleteZipAfterSideload = false;

        // Close the channel before sideloading unless explicitly disabled
        if (options.close !== false) {
            await this.closeChannel(options as CloseChannelOptions);
        }

        // Determine the zip file path based on whether zip or dir was provided
        if ('zip' in options && options.zip) {
            zipFilePath = path.resolve(cwd, options.zip);
        } else if ('dir' in options && options.dir) {
            // Generate zip from directory to a temp location
            zipFilePath = this.getOutputZipPath({ cwd: cwd });
            await this.zip({ dir: path.resolve(cwd, options.dir), out: zipFilePath, cwd: cwd });
            deleteZipAfterSideload = true;
        } else {
            throw new Error('Either zip or dir must be provided');
        }

        //only delete the dev channel for channel sideloads; a component library (`dcl`) lives in a separate
        //slot, so deleting the dev channel would needlessly wipe an installed channel that has nothing to do
        //with the complib being installed.
        if (deleteDevChannel && options.appType !== 'dcl') {
            try {
                await this.deleteDevChannel(options);
            } catch (e) {
                // note we don't report the error; as we don't actually care that we could not deploy - it's just useless noise to log it.
            }
        }

        let readStream: ReadStream;
        try {
            if ((await fsExtra.pathExists(zipFilePath)) === false) {
                throw new Error(`Cannot sideload because file does not exist at '${zipFilePath}'`);
            }
            readStream = fsExtra.createReadStream(zipFilePath);
            //wait for the stream to open (no harm in doing this, and it helps solve an issue in the tests)
            await new Promise((resolve) => {
                readStream.on('open', resolve);
            });

            const route = options.packageUploadOverrides?.route ?? 'plugin_install';
            let requestOptions = await this.generateBaseRequestOptions(route, deviceConfig, options, {
                mysubmit: 'Replace',
                archive: readStream,
                ...(options.appType ? { 'app_type': options.appType } : {})
            });

            //attach the remotedebug flag if configured
            if (options.remoteDebug) {
                requestOptions.formData.remotedebug = '1';
            }

            //attach the remotedebug_connect_early if present
            if (options.remoteDebugConnectEarly) {
                // eslint-disable-next-line camelcase
                requestOptions.formData.remotedebug_connect_early = '1';
            }

            //apply any supplied formData overrides
            for (const key in options.packageUploadOverrides?.formData ?? {}) {
                const value = options.packageUploadOverrides.formData[key];
                if (value === undefined || value === null) {
                    delete requestOptions.formData[key];
                } else {
                    requestOptions.formData[key] = value;
                }
            }

            //try to "replace" the channel first since that usually works.
            let response: HttpResponse;
            try {
                try {
                    response = await this.doPostRequest(requestOptions);
                } catch (replaceError: any) {
                    //fail if this is a compile error
                    if (this.isCompileError(replaceError.message) && failOnCompileError) {
                        const rokuMessages = this.getRokuMessagesFromResponseBody(replaceError.results?.body ?? '');
                        throw new CompileError('Compile error', {
                            httpDetails: extractHttpDetails(replaceError.results?.response, replaceError.results?.body),
                            rokuMessages: rokuMessages
                        }, replaceError);
                    } else if (this.isUpdateRequiredError(replaceError)) {
                        throw replaceError;
                    } else {
                        requestOptions.formData.mysubmit = 'Install';
                        response = await this.doPostRequest(requestOptions);
                    }
                }
            } catch (e: any) {
                //if this is a 577 error, we have high confidence that the device needs to do an update check
                if (this.isUpdateRequiredError(e)) {
                    throw new UpdateCheckRequiredError({
                        httpDetails: e.details?.httpDetails
                    }, e);

                    //a reset connection could be cause by several things, but most likely it's due to the device needing to check for updates
                } else if (e.code === 'ECONNRESET') {
                    throw new ConnectionResetError({
                        httpDetails: e.details?.httpDetails
                    }, e);
                } else {
                    //a "corrupt zip" failure is often just an undersized zip; add a helpful hint if so
                    const errorText = `${e.message} ${e.results?.body ?? ''}`;
                    if (this.isCorruptZipError(errorText)) {
                        e.message = `${e.message}${this.getUndersizedZipHint(zipFilePath)}`;
                    }
                    throw e;
                }
            }

            //if we got a non-error status code, but the body includes a message about needing to update, throw a special error
            if (this.isUpdateCheckRequiredResponse(response.body)) {
                throw new UpdateCheckRequiredError({
                    httpDetails: extractHttpDetails(response.response, response.body)
                });
            }

            //a "corrupt zip" failure can also come back in a non-error response body; add the size hint if so
            if (this.isCorruptZipError(response.body)) {
                const hint = this.getUndersizedZipHint(zipFilePath);
                if (hint) {
                    throw new Error(`Failed to publish: ${response.body}${hint}`);
                }
            }

            if (failOnCompileError) {
                if (this.isCompileError(response.body)) {
                    const rokuMessages = this.getRokuMessagesFromResponseBody(response.body);
                    throw new CompileError('Compile error', {
                        httpDetails: extractHttpDetails(response.response, response.body),
                        rokuMessages: rokuMessages
                    });
                }
            }

            if (response.body.indexOf('Identical to previous version -- not replacing.') > -1) {
                return { message: 'Identical to previous version -- not replacing', results: response };
            }
            this.logger.info('Successful sideload');
            return { message: 'Successful sideload', results: response };
        } finally {
            //delete the zip file if we generated it from rootDir
            if (deleteZipAfterSideload) {
                await fsExtra.remove(zipFilePath);
            }
            //try to close the read stream to prevent files becoming locked
            try {
                readStream?.close();
            } catch (e) {
                this.logger.warn('Error closing read stream', e);
            }
        }
    }

    /**
     * Does the response look like a compile error
     */
    private isCompileError(responseHtml: string) {
        return !!/install\sfailure:\scompilation\sfailed/i.exec(responseHtml);
    }

    /**
     * Does the text look like the device's "corrupt/invalid zip" install failure? The Roku firmware
     * returns this when a sideloaded zip can't be unzipped - most commonly because the zip is below the
     * minimum installable size (see MINIMUM_INSTALLABLE_ZIP_SIZE).
     */
    private isCorruptZipError(text: string) {
        //device text (firmware 15.x): "Install Failure: Unzip failed. Invalid or corrupt zip archive.  Unloading."
        return !!/invalid\s+or\s+corrupt\s+zip/i.exec(text);
    }

    /**
     * When a sideload fails with a "corrupt zip" error, check whether the zip is simply too small for the
     * firmware to accept. If so, return a helpful hint to append to the error; otherwise return ''.
     */
    private getUndersizedZipHint(zipFilePath: string) {
        let size: number;
        try {
            size = fsExtra.statSync(zipFilePath).size;
        } catch {
            return '';
        }
        if (size < RokuDeploy.MINIMUM_INSTALLABLE_ZIP_SIZE) {
            return ` The supplied zip is ${size} bytes, and zips smaller than ${RokuDeploy.MINIMUM_INSTALLABLE_ZIP_SIZE} bytes often cause this.`;
        }
        return '';
    }

    /**
     * Does the response look like a compile error
     */
    private isUpdateCheckRequiredResponse(responseHtml: string) {
        return !!/["']\s*Failed\s*to\s*check\s*for\s*software\s*update\s*["']/i.exec(responseHtml);
    }

    /**
     * Checks to see if the exception is due to the device needing to check for updates
     */
    private isUpdateRequiredError(e: any): boolean {
        // Check for 577 status code in the new error format (details.httpDetails.response.statusCode)
        const statusCode = e.details?.httpDetails?.response?.statusCode;
        const body = e.details?.httpDetails?.response?.body;
        return statusCode === 577 || (typeof body === 'string' && this.isUpdateCheckRequiredResponse(body));
    }

    /**
     * Converts the currently sideloaded dev app to squashfs for faster loading packages
     * @param options
     */
    public async convertToSquashfs(options: ConvertToSquashfsOptions) {
        options = { ...this.options, ...options } as ConvertToSquashfsOptions;
        this.checkRequiredOptions(options, ['device', 'password']);
        this.validatePort(options.packagePort, 'packagePort');
        this.validateTimeout(options.timeout);

        const deviceConfig = this.resolveDevice(options.device);

        let requestOptions = await this.generateBaseRequestOptions('plugin_install', deviceConfig, options, {
            archive: '',
            mysubmit: 'Convert to squashfs'
        });
        let results;
        try {
            results = await this.doPostRequest(requestOptions);
        } catch (error) {
            //Occasionally this error is seen if the zip size and file name length at the
            //wrong combination. The device fails to respond to our request with a valid response.
            //The device successfully converted the zip, so ping the device and and check the response
            //for "fileType": "squashfs" then return a happy response, otherwise throw the original error
            if ((error as any).code === 'HPE_INVALID_CONSTANT') {
                try {
                    results = await this.doPostRequest(requestOptions, false);
                    if (/"fileType"\s*:\s*"squashfs"/.test(results.body)) {
                        return results;
                    }
                } catch (e) {
                    this.logger.warn('Error converting to squashfs:', error);
                    throw error;
                }
            } else {
                throw error;
            }
        }
        if (results.body.indexOf('Conversion succeeded') === -1) {
            throw new ConvertError('Squashfs conversion failed', {
                httpDetails: extractHttpDetails(results.response, results.body),
                rokuMessages: this.getRokuMessagesFromResponseBody(results.body)
            });
        }
    }

    /**
     * resign Roku Device with a supplied signed pkg and
     * @param options
     */
    public async rekeyDevice(options: RekeyDeviceOptions) {
        options = { ...this.options, ...options } as RekeyDeviceOptions;
        this.checkRequiredOptions(options, ['device', 'password', 'pkg', 'signingPassword']);
        this.validatePort(options.packagePort, 'packagePort');
        this.validateTimeout(options.timeout);

        const deviceConfig = this.resolveDevice(options.device);

        const cwd = path.resolve(process.cwd(), options.cwd ?? '.');

        let pkgPath = options.pkg;
        if (!path.isAbsolute(options.pkg)) {
            pkgPath = path.resolve(cwd, options.pkg);
        }
        let requestOptions = await this.generateBaseRequestOptions('plugin_inspect', deviceConfig, options as any, {
            mysubmit: 'Rekey',
            passwd: options.signingPassword,
            archive: null as ReadStream
        });

        let results: HttpResponse;
        try {
            requestOptions.formData.archive = fsExtra.createReadStream(pkgPath);
            results = await this.doPostRequest(requestOptions);
        } finally {
            //ensure the stream is closed
            try {
                requestOptions.formData.archive?.close();
            } catch { }
        }

        let resultTextSearch = /<font color="red">([^<]+)<\/font>/.exec(results.body);
        if (!resultTextSearch) {
            throw new UnparsableDeviceResponseError('Unknown Rekey Failure', {
                httpDetails: extractHttpDetails(results.response, results.body),
                rokuMessages: this.getRokuMessagesFromResponseBody(results.body)
            });
        }

        if (resultTextSearch[1] !== 'Success.') {
            throw new FailedDeviceResponseError('Rekey Failure: ' + resultTextSearch[1], {
                httpDetails: extractHttpDetails(results.response, results.body),
                rokuMessages: this.getRokuMessagesFromResponseBody(results.body)
            });
        }

        if (options.devId) {
            const { devId } = await this.getDevId(options);

            if (devId !== options.devId) {
                throw new UnknownDeviceResponseError(
                    'Rekey was successful but resulting Dev ID "' + devId + '" did not match expected value of "' + options.devId + '"',
                    {
                        httpDetails: extractHttpDetails(results.response, results.body)
                    }
                );
            }
        }
    }

    /**
     * Sign a pre-existing package using Roku and return path to it locally
     * @param options
     */
    public async createSignedPackage(options: CreateSignedPackageOptions): Promise<CreateSignedPackageResult> {
        options = { ...this.options, ...options } as CreateSignedPackageOptions;
        this.logger.info('Creating signed package');
        this.checkRequiredOptions(options, ['device', 'password', 'signingPassword']);
        this.validatePort(options.packagePort, 'packagePort');
        this.validateTimeout(options.timeout);

        const deviceConfig = this.resolveDevice(options.device);

        const cwd = options.cwd ?? process.cwd();

        // Resolve output pkg path - use 'out' if provided, otherwise derive from default
        const out = this.getOutputPkgPath({ out: options.out, cwd: cwd });

        // Process options for app title and app version
        if (options.appTitle || options.appVersion) {
            if (!options.appTitle || !options.appVersion) {
                throw new Error('Either appTitle and appVersion is missing; both must be provided, or a manifestPath can be provided instead.');
            }
        } else if (options.manifestPath) {
            let manifestPath = path.resolve(cwd, options.manifestPath);
            let parsedManifest = await this.parseManifest(manifestPath);
            if (parsedManifest.major_version === undefined || parsedManifest.minor_version === undefined) {
                throw new Error('Either major or minor version is missing from the manifest');
            }
            options.appVersion = parsedManifest.major_version + '.' + parsedManifest.minor_version;
            options.appTitle = parsedManifest.title;
            if (!options.appTitle) {
                throw new Error('Value for appTitle is missing from the manifest');
            }
        } else {
            throw new Error('Either appTitle and appVersion or manifestPath must be provided');
        }

        let appName = options.appTitle + '/' + options.appVersion;

        //prevent devId mismatch (if devId is specified)
        if (options.devId) {
            const { devId: deviceDevId } = await this.getDevId(options);
            if (options.devId !== deviceDevId) {
                throw new Error(`Package signing cancelled: provided devId '${options.devId}' does not match on-device devId '${deviceDevId}'`);
            }
        }

        let requestOptions = await this.generateBaseRequestOptions('plugin_package', deviceConfig, options, {
            mysubmit: 'Package',
            pkg_time: (new Date()).getTime(), //eslint-disable-line camelcase
            passwd: options.signingPassword,
            app_name: appName //eslint-disable-line camelcase
        });

        let results = await this.doPostRequest(requestOptions);

        let failedSearchMatches = /<font.*>Failed: (.*)/.exec(results.body);
        if (failedSearchMatches) {
            throw new FailedDeviceResponseError(failedSearchMatches[1], {
                httpDetails: extractHttpDetails(results.response, results.body),
                rokuMessages: this.getRokuMessagesFromResponseBody(results.body)
            });
        }

        //grab the package url from the JSON on the page if it exists (https://regex101.com/r/1HUXgk/1)
        let pkgSearchMatches = /"pkgPath"\s*:\s*"(.*?)"/.exec(results.body);
        if (!pkgSearchMatches) {
            //for some reason we couldn't find the pkgPath from json, look in the <a> tag
            pkgSearchMatches = /<a href="(pkgs\/[^\.]+\.pkg)">/.exec(results.body);
        }
        if (pkgSearchMatches) {
            const url = pkgSearchMatches[1];
            let requestOptions2 = await this.generateBaseRequestOptions(url, deviceConfig, options);
            await this.downloadFile(requestOptions2, out);
            this.logger.info('Signed package created at:', out);
            return { pkgPath: out };
        }

        throw new UnknownDeviceResponseError('Unknown error signing package', {
            httpDetails: extractHttpDetails(results.response, results.body),
            rokuMessages: this.getRokuMessagesFromResponseBody(results.body)
        });
    }

    /**
     * Set the `User-Agent` header if missing from the request params, ensuring it's included in all requests made by roku-deploy
     * @param params
     * @returns
     */
    private setUserAgentIfMissing(params: RequestOptions) {
        if (!params) {
            params = {} as RequestOptions;
        }
        if (!params.headers) {
            params.headers = {};
        }
        if (!params.headers['User-Agent']) {
            params.headers['User-Agent'] = this.getUserAgent();
        }
        return params;
    }

    /**
     * Get the user-agent string used for HTTP requests sent by this package
     * @returns
     */
    private getUserAgent() {
        try {
            if (this._packageVersion === undefined) {
                this._packageVersion = fsExtra.readJsonSync(`${__dirname}/../package.json`).version;
            }
        } catch (e) {
            this._packageVersion = null;
        }
        return `roku-deploy/${this._packageVersion ?? 'unknown'}`;
    }

    private _packageVersion: string;

    /**
     * Centralized function for handling POST http requests
     * @param params
     */
    private async doPostRequest(params: RequestOptions, verify = true) {
        this.logger.info('handling POST request to', this.scrubAccessToken(params.url));
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {

            this.setUserAgentIfMissing(params);

            request.post(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        if (verify) {
            this.checkRequest(results);
        }
        return results as HttpResponse;
    }

    /**
     * Centralized function for handling GET http requests
     * @param params
     */
    private async doGetRequest(params: RequestOptions, verify = true) {
        this.logger.info('handling GET request to', this.scrubAccessToken(params.url));
        let results: { response: any; body: any } = await new Promise((resolve, reject) => {

            this.setUserAgentIfMissing(params);

            request.get(params, (err, resp, body) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ response: resp, body: body });
            });
        });
        if (verify) {
            this.checkRequest(results);
        }
        return results as HttpResponse;
    }

    /**
     * Redact the RCE management-api token (the `access_token` query parameter on RCE installer urls) before
     * logging a url, so it never ends up in logs.
     */
    private scrubAccessToken(url: string): string {
        //some callers exercise these request helpers with incomplete params (no url at all); leave those untouched
        return url ? url.replace(/access_token=[^&]*/i, 'access_token=<redacted>') : url;
    }

    private checkRequest(results: { response?: any; body?: any }) {
        if (!results || !results.response || typeof results.body !== 'string') {
            throw new UnparsableDeviceResponseError('Invalid response', {
                httpDetails: extractHttpDetails(results?.response, results?.body)
            });
        }

        const host = results.response.request?.host?.toString?.();
        const httpDetails = extractHttpDetails(results.response, results.body);

        if (results.response.statusCode === 401) {
            throw new UnauthorizedDeviceResponseError(
                `Unauthorized. Please verify credentials for host '${host}'`,
                {
                    httpDetails: httpDetails
                }
            );
        }

        let rokuMessages = this.getRokuMessagesFromResponseBody(results.body);

        if (rokuMessages.errors.length > 0) {
            throw new FailedDeviceResponseError(rokuMessages.errors[0], {
                httpDetails: httpDetails,
                rokuMessages: rokuMessages
            });
        }

        if (results.response.statusCode !== 200) {
            throw new InvalidDeviceResponseCodeError(
                'Invalid response code: ' + results.response.statusCode,
                {
                    httpDetails: httpDetails,
                    rokuMessages: rokuMessages
                }
            );
        }
    }

    private getRokuMessagesFromResponseBody(body: string): RokuMessages {
        const result = {
            errors: [] as string[],
            infos: [] as string[],
            successes: [] as string[]
        };
        let errorRegex = /Shell\.create\('Roku\.Message'\)\.trigger\('[\w\s]+',\s+'(\w+)'\)\.trigger\('[\w\s]+',\s+'(.*?)'\)/igm;
        let match: RegExpExecArray;

        while ((match = errorRegex.exec(body))) {
            let [, messageType, message] = match;
            switch (messageType.toLowerCase()) {
                case RokuMessageType.error:
                    if (!result.errors.includes(message)) {
                        result.errors.push(message);
                    }
                    break;

                case RokuMessageType.info:
                    if (!result.infos.includes(message)) {
                        result.infos.push(message);
                    }
                    break;

                case RokuMessageType.success:
                    if (!result.successes.includes(message)) {
                        result.successes.push(message);
                    }
                    break;

                default:
                    break;
            }
        }

        let jsonParseRegex = /JSON\.parse\(('.+')\);/igm;
        let jsonMatch: RegExpExecArray;

        while ((jsonMatch = jsonParseRegex.exec(body))) {
            let [, jsonString] = jsonMatch;
            let jsonObject = parseJsonc(jsonString);
            if (typeof jsonObject === 'object' && !Array.isArray(jsonObject) && jsonObject !== null) {
                let messages = jsonObject.messages;

                if (!Array.isArray(messages)) {
                    continue;
                }

                for (let messageObject of messages) {
                    // Try to duck type the object to make sure it is some form of message to be displayed
                    if (typeof messageObject.type === 'string' && messageObject.text_type === 'text' && typeof messageObject.text === 'string') {
                        const messageType: string = messageObject.type;
                        const text: string = messageObject.text;
                        switch (messageType.toLowerCase()) {
                            case RokuMessageType.error:
                                if (!result.errors.includes(text)) {
                                    result.errors.push(text);
                                }
                                break;

                            case RokuMessageType.info:
                                if (!result.infos.includes(text)) {
                                    result.infos.push(text);
                                }
                                break;

                            case RokuMessageType.success:
                                if (!result.successes.includes(text)) {
                                    result.successes.push(text);
                                }

                                break;

                            default:
                                break;
                        }
                    }
                }
            }

        }

        return result;
    }

    /**
     * Parse out the list of packages that are currently installed on the device by looking for the JSON in the response body
     * @param body
     * @returns
     */
    private getPackagesFromResponseBody(body: string): RokuPlugin[] {
        let jsonParseRegex = /JSON\.parse\(('.+')\);/igm;
        let jsonMatch: RegExpExecArray;

        while ((jsonMatch = jsonParseRegex.exec(body))) {
            let [, jsonString] = jsonMatch;
            let jsonObject = parseJsonc(jsonString);
            if (typeof jsonObject === 'object' && !Array.isArray(jsonObject) && jsonObject !== null) {
                let packages = jsonObject.packages;

                if (!Array.isArray(packages)) {
                    continue;
                }
                return packages;
            }
        }
        return [];
    }

    /**
     * Deletes any installed dev channel on the target Roku device
     * @param options
     */
    public async deleteDevChannel(options?: DeleteDevChannelOptions) {
        options = { ...this.options, ...options } as DeleteDevChannelOptions;
        this.logger.info('Deleting dev channel...');
        this.checkRequiredOptions(options, ['device', 'password']);
        this.validatePort(options.packagePort, 'packagePort');
        this.validateTimeout(options.timeout);

        const deviceConfig = this.resolveDevice(options.device);

        let deleteOptions = await this.generateBaseRequestOptions('plugin_install', deviceConfig, options);
        deleteOptions.formData = {
            mysubmit: 'Delete',
            archive: ''
        };
        return this.doPostRequest(deleteOptions);
    }

    /**
     * Deletes any installed dev channel, and any installed component libraries on the target Roku device
     * @param options
     */
    public async deleteAllSideloadedPlugins(options?: DeleteDevChannelOptions) {
        options = { ...this.options, ...options } as DeleteDevChannelOptions;
        this.checkRequiredOptions(options, ['device', 'password']);

        const deviceConfig = this.resolveDevice(options.device);

        let deleteOptions = await this.generateBaseRequestOptions('plugin_install', deviceConfig, options);
        deleteOptions.formData = {
            mysubmit: 'DeleteAll',
            archive: ''
        };
        return this.doPostRequest(deleteOptions);
    }

    /**
     * Delete the component library with the specified filename from the device
     */
    public async deleteComponentLibrary(options?: DeleteComponentLibraryOptions) {
        options = { ...this.options, ...options } as DeleteComponentLibraryOptions;
        this.checkRequiredOptions(options, ['device', 'password', 'fileName']);

        const deviceConfig = this.resolveDevice(options.device);

        let deleteOptions = await this.generateBaseRequestOptions('plugin_install', deviceConfig, options);
        deleteOptions.formData = {
            mysubmit: 'Delete',
            'app_type': 'dcl',
            fileName: options.fileName
        };
        deleteOptions.qs ??= {};
        // eslint-disable-next-line camelcase
        deleteOptions.qs.dcl_enabled = '1';
        await this.doPostRequest(deleteOptions);
    }

    /**
     * Delete all component libraries from the device
     */
    public async deleteAllComponentLibraries(options: DeleteAllComponentLibrariesOptions) {
        options = { ...this.options, ...options } as DeleteAllComponentLibrariesOptions;
        const packages = await this.listSideloadedPlugins(options);
        for (const pkg of packages) {
            if (pkg.appType === 'dcl') {
                await this.deleteComponentLibrary({
                    ...options,
                    fileName: pkg.archiveFileName
                });
            }
        }
    }

    /**
     * Fetch the full list of installed plugins (side-loaded packages) from the device. Useful for finding the
     * file names of installed component libraries or the dev channel.
     */
    public async listSideloadedPlugins(options: ListSideloadedPluginsOptions): Promise<RokuPlugin[]> {
        options = { ...this.options, ...options } as ListSideloadedPluginsOptions;
        this.checkRequiredOptions(options, ['device', 'password']);

        const deviceConfig = this.resolveDevice(options.device);

        let deleteOptions = await this.generateBaseRequestOptions('plugin_install', deviceConfig, options);
        deleteOptions.qs ??= {};
        // eslint-disable-next-line camelcase
        deleteOptions.qs.dcl_enabled = '1';
        const result = await this.doGetRequest(deleteOptions);
        const packages = this.getPackagesFromResponseBody(result.body);
        return packages;
    }

    /**
     * Gets a screenshot from the device. A side-loaded channel must be running or an error will be thrown.
     * Always returns an object with the screenshot buffer. If `out` is provided, also saves to disk.
     */

    public async captureScreenshot(options: CaptureScreenshotOptions): Promise<CaptureScreenshotResult> {
        options = { ...this.options, ...options } as CaptureScreenshotOptions;
        this.checkRequiredOptions(options, ['device', 'password']);
        this.validatePort(options.packagePort, 'packagePort');
        this.validateTimeout(options.timeout);

        const deviceConfig = this.resolveDevice(options.device);

        // Ask for the device to make an image
        let createScreenshotResult = await this.doPostRequest({
            ...(await this.generateBaseRequestOptions('plugin_inspect', deviceConfig, options)),
            formData: {
                mysubmit: 'Screenshot',
                archive: ''
            }
        });

        // Pull the image url out of the response body
        const [_, imageUrlOnDevice, deviceExt] = /["'](pkgs\/dev(\.jpg|\.png)\?.+?)['"]/gi.exec(createScreenshotResult.body) ?? [];

        if (!imageUrlOnDevice) {
            throw new Error('No screenshot url returned from device');
        }

        const requestParams = await this.generateBaseRequestOptions(imageUrlOnDevice, deviceConfig, options);

        // Always download to buffer
        const buffer = await this.downloadToBuffer(requestParams);

        const result: CaptureScreenshotResult = { buffer: buffer };

        // If out is provided, also save to disk
        if (options.out) {
            const cwd = options.cwd ?? process.cwd();
            const screenshotDir = options.screenshotDir
                ? path.resolve(cwd, options.screenshotDir)
                : path.join(util.tempDir, '/roku-deploy/screenshots/');

            let filePath: string;
            if (options.out === true) {
                // Use default directory with generated filename
                const defaultFilename = `screenshot-${formatTimestampForScreenshot()}${deviceExt}`;
                filePath = path.resolve(cwd, screenshotDir, defaultFilename);
            } else {
                // User provided a path
                filePath = path.resolve(cwd, options.out);
                const userExt = path.extname(filePath).toLowerCase();
                const deviceExtLower = deviceExt.toLowerCase();

                if (options.autoExtension) {
                    if (userExt === deviceExtLower) {
                        // User extension matches device extension - use as-is
                    } else if (userExt === '.jpg' || userExt === '.jpeg' || userExt === '.png') {
                        // User provided an image extension that doesn't match - swap it
                        filePath = filePath.slice(0, -userExt.length) + deviceExt;
                    } else {
                        // No recognized image extension - append device extension
                        filePath += deviceExt;
                    }
                }
            }

            await fsExtra.ensureFile(filePath);
            await fsExtra.writeFile(filePath, buffer);
            result.filePath = filePath;
        }

        return result;
    }

    private async downloadFile(requestParams: any, filePath: string) {
        let writeStream: WriteStream;
        await fsExtra.ensureFile(filePath);
        return new Promise<string>((resolve, reject) => {
            writeStream = fsExtra.createWriteStream(filePath, {
                flags: 'w'
            });
            if (!writeStream) {
                reject(new Error(`Unable to create write stream for "${filePath}"`));
                return;
            }
            //when the file has finished writing to disk, we can finally resolve and say we're done
            writeStream.on('finish', () => {
                resolve(filePath);
            });
            //if anything does wrong with the write stream, reject the promise
            writeStream.on('error', (error) => {
                reject(error);
            });

            request.get(requestParams).on('error', (err) => {
                reject(err);
            }).on('response', (response) => {
                if (response.statusCode !== 200) {
                    return reject(new Error('Invalid response code: ' + response.statusCode));
                }
            }).pipe(writeStream);

        }).finally(() => {
            try {
                writeStream.close();
            } catch { }
        });
    }

    private downloadToBuffer(requestParams: any): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            request.get(requestParams)
                .on('error', (err) => {
                    reject(err);
                })
                .on('response', (response) => {
                    if (response.statusCode !== 200) {
                        return reject(new Error('Invalid response code: ' + response.statusCode));
                    }
                })
                .on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                })
                .on('end', () => {
                    resolve(Buffer.concat(chunks));
                });
        });
    }

    public checkRequiredOptions<T extends Record<string, any>>(options: T, requiredOptions: Array<keyof T>) {
        for (let opt of requiredOptions as string[]) {
            if (options[opt] === undefined) {
                throw new Error('Missing required option: ' + opt);
            }
        }
    }

    /**
     * Resolve a DeviceOption (string or DeviceConfig) to a concrete DeviceConfig.
     * If string, looks up in the devices registry. If object, validates and returns.
     */
    private resolveDevice(device: DeviceOption): DeviceConfig {
        // String = registry lookup
        if (typeof device === 'string') {
            const entry = this.options.devices?.[device];
            if (!entry) {
                throw new Error(`Device '${device}' not found in devices registry`);
            }
            return this.extractDeviceConfig(entry);
        }
        // Object = inline config, validate and return
        this.validateDeviceConfig(device);
        return device;
    }

    /**
     * Validate that a device config has exactly one identifier (host, esn, id, or instanceUrl).
     */
    private validateDeviceConfig(config: DeviceConfig): void {
        const identifiers = [
            (config as any).host,
            (config as any).esn,
            (config as any).id,
            (config as any).instanceUrl
        ].filter(Boolean);

        if (identifiers.length === 0) {
            throw new InvalidOptionError(
                'Device must specify host, esn, id, or instanceUrl',
                { optionName: 'device' }
            );
        }
        if (identifiers.length > 1) {
            throw new InvalidOptionError(
                'Device cannot specify multiple identifiers (host, esn, id, instanceUrl)',
                { optionName: 'device' }
            );
        }
    }

    /**
     * Extract a DeviceConfig from a DeviceRegistryEntry.
     */
    private extractDeviceConfig(entry: DeviceRegistryEntry): DeviceConfig {
        if (entry.host) {
            return { host: entry.host };
        }
        if (entry.esn) {
            return { esn: entry.esn, rceToken: entry.rceToken };
        }
        if (entry.id) {
            return { id: entry.id, rceToken: entry.rceToken };
        }
        if (entry.instanceUrl) {
            return { instanceUrl: entry.instanceUrl, rceToken: entry.rceToken };
        }
        throw new Error('Device registry entry has no valid identifier (host, esn, id, or instanceUrl)');
    }

    /**
     * Get the host from a resolved DeviceConfig. Throws if it's an RCE device.
     */
    private getHost(deviceConfig: DeviceConfig): string {
        if (isRceDeviceConfig(deviceConfig)) {
            throw new Error('RCE devices are not yet supported');
        }
        return deviceConfig.host;
    }

    /**
     * Validate that a port number is a valid integer between 1 and 65535
     */
    private validatePort(value: unknown, name: string): void {
        if (value === undefined) {
            return; // Optional ports use defaults
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
            throw new InvalidOptionError(
                `Invalid ${name}: must be an integer between 1 and 65535, received '${value}'`,
                { optionName: name, providedValue: value }
            );
        }
    }

    /**
     * Validate that a timeout is a positive integer
     */
    private validateTimeout(value: unknown): void {
        if (value === undefined) {
            return; // Optional timeout uses default
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            throw new InvalidOptionError(
                `Invalid timeout: must be a positive integer in milliseconds, received '${value}'`,
                { optionName: 'timeout', providedValue: value }
            );
        }
    }

    /**
     * Validate that a value is one of the allowed enum values
     */
    private validateEnum<T>(value: unknown, name: string, allowedValues: readonly T[]): void {
        if (value === undefined || value === null) {
            return; // Optional enums are allowed, null means "don't include"
        }
        if (!allowedValues.includes(value as T)) {
            throw new InvalidOptionError(
                `Invalid ${name}: must be one of ${allowedValues.map(v => `'${v}'`).join(', ')}, received '${value}'`,
                { optionName: name, providedValue: value }
            );
        }
    }

    /**
     * Check whether the given developer password is accepted by a Roku device.
     * Resolves `true` if the device accepts the credentials, `false` if it rejects them.
     * Throws `DeviceUnreachableError` for network failures and `InvalidDeviceResponseCodeError` for unexpected statuses.
     */
    public async validateDeveloperPassword(options: ValidateDeveloperPasswordOptions): Promise<boolean> {
        options = { ...this.options, ...options } as ValidateDeveloperPasswordOptions;
        this.checkRequiredOptions(options, ['device', 'password']);

        const deviceConfig = this.resolveDevice(options.device);

        const username = options.username ?? RokuDeploy.defaults.username;
        const port = options.port ?? 80;
        const timeout = options.timeout ?? 3000;

        const { baseUrl, query } = await this.getInstallerBaseUrl(deviceConfig, port);
        const url = query ? `${baseUrl}/plugin_install?${query}` : `${baseUrl}/plugin_install`;
        //for the unreachable/unexpected-status messages: a local device is identified by its host (unchanged
        //from before), an RCE device by its installer base url (never includes the access_token query param)
        const displayTarget = isRceDeviceConfig(deviceConfig) ? baseUrl : deviceConfig.host;

        let response: Response;
        try {
            response = await fetchWithDigest(url, {
                method: 'HEAD',
                username: username,
                password: options.password,
                timeout: timeout
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new DeviceUnreachableError(`Device ${displayTarget} was unreachable: ${message}`, err);
        }

        if (response.status === 200) {
            return true;
        }
        if (response.status === 401) {
            return false;
        }
        throw new InvalidDeviceResponseCodeError(`Unexpected status ${response.status} from device at ${displayTarget}`, response as any);
    }

    /**
     * Get the `device-info` response from a Roku device
     * @param host the host or IP address of the Roku
     * @param port the port to use for the ECP request (defaults to 8060)
     */
    public async getDeviceInfo(options?: GetDeviceInfoOptions & { enhance: true }): Promise<DeviceInfo>;
    public async getDeviceInfo(options?: GetDeviceInfoOptions): Promise<DeviceInfoRaw>;
    public async getDeviceInfo(options: GetDeviceInfoOptions) {
        options = { ...this.options, ...options } as GetDeviceInfoOptions;
        this.checkRequiredOptions(options, ['device']);

        let result: EcpResult;
        try {
            result = await this.ecp(options.device, 'query/device-info', {
                verify: true,
                ecpPort: options.ecpPort,
                timeout: options.timeout
            });
        } catch (e) {
            if ((e as any)?.details?.httpDetails?.response?.headers?.server?.includes('Roku')) {
                throw new EcpNetworkAccessModeDisabledError(
                    `Unable to access device-info because ecp-setting-mode is 'disabled'`,
                    {
                        httpDetails: (e as any)?.details?.httpDetails
                    },
                    e instanceof Error ? e : undefined
                );
            }
            throw e;
        }
        try {
            let deviceInfo = {
                ...result.json['device-info']
            } as Record<string, any>;

            if (options.enhance) {
                deviceInfo = this.enhanceDeviceInfo(deviceInfo as DeviceInfoRaw);
            }
            this.logger.debug('Device info:', deviceInfo);
            return deviceInfo;
        } catch (e) {
            this.logger.warn('Error getting device info:', e);
            throw new UnparsableDeviceResponseError('Could not retrieve device info', {
                httpDetails: extractHttpDetails(undefined, result.body)
            }, e instanceof Error ? e : undefined);
        }
    }

    /**
     * Get the External Control Protocol (ECP) setting mode of the device. This determines whether
     * the device accepts remote control commands via the ECP API.
     *
     * @param options - Configuration options including host, ecpPort, timeout, etc.
     * @returns The ECP setting mode:
     *   - 'enabled': fully enabled and accepting commands
     *   - 'disabled': ECP is disabled (device may still be reachable but ECP commands won't work)
     *   - 'limited': Restricted functionality, text and movement commands only
     *   - 'permissive': Full access for internal networks
     */
    public async getEcpNetworkAccessMode(options: GetDeviceInfoOptions): Promise<EcpNetworkAccessMode> {
        options = { ...this.options, ...options } as GetDeviceInfoOptions;
        try {
            const deviceInfo = await this.getDeviceInfo(options);
            return deviceInfo['ecp-setting-mode'];
        } catch (e) {
            if ((e as any)?.details?.httpDetails?.response?.headers?.server?.includes('Roku')) {
                return 'disabled';
            }
            throw new UnknownDeviceResponseError('Could not retrieve device ECP setting', {}, e instanceof Error ? e : undefined);
        }
    }

    /**
     * Query the list of channels currently installed on the device (the ECP `query/apps` endpoint).
     * @param options
     */
    public async queryApps(options: QueryAppsOptions): Promise<RokuAppDescriptor[]> {
        options = { ...this.options, ...options } as QueryAppsOptions;
        this.checkRequiredOptions(options, ['device']);

        let result: EcpResult;
        try {
            result = await this.ecp(options.device, 'query/apps', {
                ecpPort: options.ecpPort,
                timeout: options.timeout
            });
        } catch (e) {
            if (e instanceof UnparsableDeviceResponseError) {
                this.logger.warn('Error parsing installed app list:', e);
                throw new UnparsableDeviceResponseError('Could not retrieve installed app list', e.details, e);
            }
            throw e;
        }
        this.assertEcpStatusOk(result);
        const rawAppNodes = result.json?.apps?.app;
        if (!rawAppNodes) {
            return [];
        }
        const appNodes = Array.isArray(rawAppNodes) ? rawAppNodes : [rawAppNodes];
        return appNodes.map((appNode) => {
            const parsedApp = this.parseEcpAppElement(appNode);
            return {
                id: parsedApp.id ?? '',
                title: parsedApp.title ?? '',
                type: parsedApp.type,
                subtype: parsedApp.subtype,
                version: parsedApp.version
            };
        });
    }

    /**
     * Query the currently active app on the device (the ECP `query/active-app` endpoint). The active
     * "app" may be the Roku home screen or a screensaver rather than a sideloaded channel.
     * @param options
     */
    public async queryActiveApp(options: QueryActiveAppOptions): Promise<RokuActiveApp> {
        options = { ...this.options, ...options } as QueryActiveAppOptions;
        this.checkRequiredOptions(options, ['device']);

        let result: EcpResult;
        try {
            result = await this.ecp(options.device, 'query/active-app', {
                ecpPort: options.ecpPort,
                timeout: options.timeout
            });
        } catch (e) {
            if (e instanceof UnparsableDeviceResponseError) {
                this.logger.warn('Error parsing active app:', e);
                throw new UnparsableDeviceResponseError('Could not retrieve active app', e.details, e);
            }
            throw e;
        }
        this.assertEcpStatusOk(result);
        const rawActiveAppNode = result.json?.['active-app']?.app;
        if (!rawActiveAppNode) {
            return {};
        }
        return this.parseEcpAppElement(rawActiveAppNode);
    }

    /**
     * Parse a single `<app>` element from a `query/apps` or `query/active-app` response. With
     * `explicitArray: false`, an app node with attributes and a title is `{ _: 'Title', $: { id, type, subtype, version } }`;
     * an attribute-less app node (for example the home screen) collapses to a plain string.
     * @param appElement
     */
    private parseEcpAppElement(appElement: any): RokuActiveApp {
        if (appElement === undefined || appElement === null) {
            return {};
        }
        if (typeof appElement === 'string') {
            return { title: appElement };
        }
        const attributes = appElement.$ ?? {};
        return {
            id: attributes.id,
            title: appElement._,
            type: attributes.type,
            subtype: attributes.subtype,
            version: attributes.version
        };
    }

    /**
     * Query a sideloaded (or installed) app's registry (the ECP `query/registry/{appId}` endpoint).
     * Throws a FailedDeviceResponseError when the device reports a failure (for example
     * `Device not keyed`).
     * @param options
     */
    public async queryRegistry(options: QueryRegistryOptions): Promise<RokuRegistry> {
        options = { ...this.options, ...options } as QueryRegistryOptions;
        this.checkRequiredOptions(options, ['device', 'appId']);

        const result = await this.ecp(options.device, `query/registry/${options.appId}`, {
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
        const root = this.getEcpEnvelope(result, 'plugin-registry', 'Could not retrieve registry');

        const registry = root.registry ?? {};
        const sections: RokuRegistry['sections'] = {};
        for (const section of this.toArray(registry.sections?.section)) {
            if (!section || typeof section === 'string') {
                continue;
            }
            const sectionName = section.name;
            for (const item of this.toArray(section.items?.item)) {
                if (!item || typeof item === 'string') {
                    continue;
                }
                sections[sectionName] ??= {};
                sections[sectionName][item.key] = item.value;
            }
        }
        return {
            devId: registry['dev-id'],
            plugins: typeof registry.plugins === 'string' ? registry.plugins.split(',') : undefined,
            spaceAvailable: registry['space-available'],
            sections: sections
        };
    }

    /**
     * Query the state of an app on the device (the ECP `query/app-state/{appId}` endpoint).
     * Throws a FailedDeviceResponseError when the device reports a failure.
     * @param options
     */
    public async queryAppState(options: QueryAppStateOptions): Promise<RokuAppState> {
        options = { ...this.options, ...options } as QueryAppStateOptions;
        this.checkRequiredOptions(options, ['device', 'appId']);

        const result = await this.ecp(options.device, `query/app-state/${options.appId}`, {
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
        const root = this.getEcpEnvelope(result, 'app-state', 'Could not retrieve app state');

        const knownStates: RokuAppStateValue[] = ['active', 'background', 'inactive'];
        const state = knownStates.find(knownState => knownState === root.state?.toLowerCase()) ?? 'unknown';
        return {
            appId: root['app-id'],
            appDevId: root['app-dev-id'],
            appTitle: root['app-title'],
            appVersion: root['app-version'],
            state: state
        };
    }

    /**
     * Query SceneGraph rendezvous tracking (the ECP `query/sgrendezvous` endpoint): whether tracking
     * is enabled, plus any rendezvous events recorded since the last query.
     * Throws a FailedDeviceResponseError when the device reports a failure.
     * @param options
     */
    public async queryRendezvous(options: QueryRendezvousOptions): Promise<RokuRendezvous> {
        options = { ...this.options, ...options } as QueryRendezvousOptions;
        this.checkRequiredOptions(options, ['device']);

        const result = await this.ecp(options.device, 'query/sgrendezvous', {
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
        const root = this.getEcpEnvelope(result, 'sgrendezvous', 'Could not retrieve rendezvous tracking');

        return {
            trackingEnabled: root.data?.['tracking-enabled'] === 'true',
            items: this.toArray(root.data?.item).filter(item => item && typeof item !== 'string').map(item => ({
                id: item.id,
                startTime: item['start-tm'],
                endTime: item['end-tm'],
                lineNumber: item['line-number'],
                file: item.file
            }))
        };
    }

    /**
     * Enable or disable SceneGraph rendezvous tracking (the ECP `sgrendezvous/track|untrack`
     * endpoint) and return the tracking state the device reports afterwards.
     * Throws a FailedDeviceResponseError when the device reports a failure.
     * @param options
     */
    public async setRendezvousTracking(options: SetRendezvousTrackingOptions): Promise<boolean> {
        options = { ...this.options, ...options } as SetRendezvousTrackingOptions;
        this.checkRequiredOptions(options, ['device', 'enabled']);

        const result = await this.ecp(options.device, `sgrendezvous/${options.enabled ? 'track' : 'untrack'}`, {
            method: 'POST',
            ecpPort: options.ecpPort,
            timeout: options.timeout
        });
        const root = this.getEcpEnvelope(result, 'sgrendezvous', 'Could not set rendezvous tracking');
        return root['tracking-enabled'] === 'true';
    }

    /**
     * Unwrap a standard ECP response envelope: return the root element of the parsed body, throwing
     * a FailedDeviceResponseError (with the device's own error message) when the element carries a
     * non-OK `<status>` - which ECP reports with a 202 rather than an error status code - and an
     * UnparsableDeviceResponseError when the expected root element is missing entirely.
     */
    private getEcpEnvelope(result: EcpResult, rootKey: string, failureMessage: string): Record<string, any> {
        const root = result.json?.[rootKey];
        if (!root) {
            //a non-xml ECP response is usually the device explaining itself in plain text (for
            //example `ECP command not allowed in Limited mode.`), so carry that text in the error
            const bodyText = typeof result.body === 'string' ? result.body.trim() : '';
            throw new UnparsableDeviceResponseError(bodyText ? `${failureMessage}: ${bodyText}` : failureMessage, {
                httpDetails: extractHttpDetails(undefined, result.body)
            });
        }
        if (typeof root.status === 'string' && root.status.toLowerCase() !== 'ok') {
            throw new FailedDeviceResponseError(`${failureMessage}: ${root.error ?? 'Unknown error'}`, {
                httpDetails: extractHttpDetails(undefined, result.body)
            });
        }
        return root;
    }

    /**
     * Normalize an xml2js `explicitArray: false` node that may be a single element, an array of
     * elements, or absent, into an array.
     */
    private toArray(node: any): any[] {
        if (node === undefined || node === null) {
            return [];
        }
        return Array.isArray(node) ? node : [node];
    }

    /**
     * Enhance a raw device-info object into its normalized form. This camel-cases the property names and
     * normalizes each value to its native format (boolean strings to booleans, number strings to numbers,
     * decoding HtmlEntities, etc.). This is the same enhancement `getDeviceInfo` applies when called with
     * `{ enhance: true }`, exposed separately so callers that already have a raw device-info object can
     * enhance it without making another request to the device.
     * @param deviceInfo the raw device-info object to enhance
     */
    public enhanceDeviceInfo(deviceInfo: DeviceInfoRaw): DeviceInfo {
        const result = {} as DeviceInfo;
        // sanitize/normalize values to their native formats, and also convert property names to camelCase
        for (let key in deviceInfo) {
            result[util.camelCase(key)] = this.normalizeDeviceInfoFieldValue(deviceInfo[key]);
        }
        return result;
    }

    /**
     * Normalize a deviceInfo field value. This includes things like converting boolean strings to booleans, number strings to numbers,
     * decoding HtmlEntities, etc.
     * @param deviceInfo
     */
    private normalizeDeviceInfoFieldValue(value: any) {
        // non-string values have nothing to normalize; return them unchanged
        if (typeof value !== 'string') {
            return value;
        }
        let num: number;
        // convert 'true' and 'false' string values to boolean
        if (value === 'true') {
            return true;
        } else if (value === 'false') {
            return false;
        } else if (value.trim() !== '' && !isNaN(num = Number(value))) {
            return num;
        } else {
            return util.decodeHtmlEntities(value);
        }
    }

    /**
     * Get the developer ID from the device-info response
     * @param options
     * @returns
     */
    public async getDevId(options?: GetDevIdOptions): Promise<GetDevIdResult> {
        options = { ...this.options, ...options } as GetDevIdOptions;
        this.checkRequiredOptions(options, ['device']);
        const deviceInfo = await this.getDeviceInfo(options);
        this.logger.debug('Found dev id:', deviceInfo['keyed-developer-id']);
        return { devId: deviceInfo['keyed-developer-id'] };
    }

    private async parseManifest(manifestPath: string): Promise<ManifestData> {
        if (!await fsExtra.pathExists(manifestPath)) {
            throw new Error(manifestPath + ' does not exist');
        }

        let manifestContents = await fsExtra.readFile(manifestPath, 'utf-8');
        return this.parseManifestFromString(manifestContents);
    }

    private parseManifestFromString(manifestContents: string): ManifestData {
        let manifestLines = manifestContents.split('\n');
        let manifestData: ManifestData = {};
        manifestData.keyIndexes = {};
        manifestData.lineCount = manifestLines.length;
        manifestLines.forEach((line, index) => {
            let match = /(\w+)=(.+)/.exec(line);
            if (match) {
                let key = match[1];
                manifestData[key] = match[2];
                manifestData.keyIndexes[key] = index;
            }
        });

        return manifestData;
    }

    public async rebootDevice(options: RebootDeviceOptions) {
        options = { ...this.options, ...options } as RebootDeviceOptions;
        this.checkRequiredOptions(options, ['device', 'password']);

        const deviceConfig = this.resolveDevice(options.device);

        // Get device info to check software version
        const deviceInfo = await this.getDeviceInfo(options);
        const softwareVersion = deviceInfo['software-version'];

        // Check if device version is at least 15.0.4
        if (!softwareVersion || semver.lt(semver.coerce(softwareVersion), '15.0.4')) {
            throw new UnsupportedFirmwareVersionError(
                `Device software version ${softwareVersion} is below the minimum required version 15.0.4 for reboot operation`,
                {
                    currentVersion: softwareVersion,
                    minimumVersion: '15.0.4',
                    operation: 'reboot'
                }
            );
        }

        return this.doPostRequest({
            ...(await this.generateBaseRequestOptions('plugin_swup', deviceConfig, options)),
            formData: {
                mysubmit: 'Reboot',
                archive: ''
            }
        });
    }

    public async checkForUpdate(options: CheckForUpdateOptions) {
        options = { ...this.options, ...options } as CheckForUpdateOptions;
        this.checkRequiredOptions(options, ['device', 'password']);

        const deviceConfig = this.resolveDevice(options.device);

        // Get device info to check software version
        const deviceInfo = await this.getDeviceInfo(options);
        const softwareVersion = deviceInfo['software-version'];

        // Check if device version is at least 15.0.4
        if (!softwareVersion || semver.lt(semver.coerce(softwareVersion), '15.0.4')) {
            throw new UnsupportedFirmwareVersionError(
                `Device software version ${softwareVersion} is below the minimum required version 15.0.4 for check update operation`,
                {
                    currentVersion: softwareVersion,
                    minimumVersion: '15.0.4',
                    operation: 'checkForUpdate'
                }
            );
        }

        return this.doPostRequest({
            ...(await this.generateBaseRequestOptions('plugin_swup', deviceConfig, options)),
            formData: {
                mysubmit: 'CheckUpdate',
                archive: ''
            }
        });
    }
}

export interface ManifestData {
    [key: string]: any;
    keyIndexes?: Record<string, number>;
    lineCount?: number;
}

export interface StandardizedFileEntry {
    /**
     * The full path to the source file
     */
    src: string;
    /**
     * The path relative to the root of the pkg to where the file should be placed
     */
    dest: string;
}

export interface RokuMessages {
    errors: string[];
    infos: string[];
    successes: string[];
}

export interface RokuPlugin {
    appType: 'channel' | 'dcl';
    archiveFileName: string;
    fileType: string;
    id: number;
    location: string;
    md5: string;
    pkgPath: string;
    size: string;
}
export type RokuPackage = RokuPlugin;

export type ListSideloadedPluginsOptions = BaseRequestOptions;

enum RokuMessageType {
    success = 'success',
    info = 'info',
    error = 'error'
}

export interface HttpResponse {
    response: any;
    body: any;
}

export interface CaptureScreenshotOptions extends BaseRequestOptions {
    /**
     * When provided, saves the screenshot to disk in addition to returning the buffer.
     * - If `true`, saves to the default location (screenshotDir or OS temp directory)
     * - If a string path, saves to that location
     */
    out?: string | true;

    /**
     * The current working directory to use for relative paths
     */
    cwd?: string;

    /**
     * The directory where screenshots should be saved when `out` is `true`.
     * Defaults to the OS temp directory.
     */
    screenshotDir?: string;

    /**
     * When false (default), the filename is used exactly as provided by the user.
     * When true, the extension is automatically handled:
     *   - If the user's filename ends with the device's extension, use it as-is
     *   - If the user's filename ends with .png or .jpg but doesn't match the device's format, swap the extension
     *   - Otherwise, append the device's extension to the filename
     * @default false
     */
    autoExtension?: boolean;
}

export interface CaptureScreenshotResult {
    /**
     * The screenshot image data
     */
    buffer: Buffer;
    /**
     * The file path where the screenshot was saved (only present when `out` option was provided)
     */
    filePath?: string;
}

export interface GetDeviceInfoOptions extends BaseEcpOptions {
    /**
     * Should the device-info be enhanced by camel-casing the property names and converting boolean strings to booleans and number strings to numbers?
     * @default false
     */
    enhance?: boolean;
}

export type QueryAppsOptions = BaseEcpOptions;

export type QueryActiveAppOptions = BaseEcpOptions;

export interface ValidateDeveloperPasswordOptions {
    /** The target device. Can be a registry name (string) or an inline device config. */
    device: DeviceOption;

    /** The developer password to check */
    password: string;

    /** Defaults to `'rokudev'` */
    username?: string;

    /** Defaults to `80` (the developer web-server port) */
    port?: number;

    /** Milliseconds to wait for each HTTP round-trip. Defaults to `3000`. */
    timeout?: number;
}

/**
 * The remote-control keys a Roku understands, in the canonical casing the device expects. Exposed
 * for convenience and discoverability: pass a `RemoteKey` value and you get the casing right without
 * thinking about it. It is NOT an enforced list - every key option also accepts a raw string, so a
 * key without a member here (or a `Lit_<char>` literal) can still be sent.
 */
export enum RemoteKey {
    Back = 'Back',
    Backspace = 'Backspace',
    ChannelDown = 'ChannelDown',
    ChannelUp = 'ChannelUp',
    Down = 'Down',
    Enter = 'Enter',
    FindRemote = 'FindRemote',
    Fwd = 'Fwd',
    Guide = 'Guide',
    Home = 'Home',
    Info = 'Info',
    InputAV1 = 'InputAV1',
    InputHDMI1 = 'InputHDMI1',
    InputHDMI2 = 'InputHDMI2',
    InputHDMI3 = 'InputHDMI3',
    InputHDMI4 = 'InputHDMI4',
    InputTuner = 'InputTuner',
    InstantReplay = 'InstantReplay',
    Left = 'Left',
    Play = 'Play',
    Power = 'Power',
    PowerOff = 'PowerOff',
    PowerOn = 'PowerOn',
    Rev = 'Rev',
    Right = 'Right',
    Search = 'Search',
    Select = 'Select',
    Up = 'Up',
    VolumeDown = 'VolumeDown',
    VolumeMute = 'VolumeMute',
    VolumeUp = 'VolumeUp'
}

export type RemoteKeyText = keyof typeof RemoteKey;

interface SendKeyEventOptions extends BaseEcpOptions {
    action?: 'keydown' | 'keypress' | 'keyup';
    //internal transport type: the public key methods enforce RemoteKeyText, but sendText feeds
    //`lit_<char>` literals through here and callers pass canonical keys, so this stays permissive
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    key: RemoteKeyText | string;
}

export interface KeyUpOptions extends BaseEcpOptions {
    key: RemoteKeyText;
}

export interface KeyDownOptions extends BaseEcpOptions {
    key: RemoteKeyText;
}

export interface KeyPressOptions extends BaseEcpOptions {
    key: RemoteKeyText;
}

export interface SendTextOptions extends BaseEcpOptions {
    text: string;
}

export type CloseChannelOptions = BaseEcpOptions;

export interface LaunchAppOptions extends BaseEcpOptions {
    /** The channel id to launch (for example 'dev' for the sideloaded dev channel). */
    appId: string;
    /** An optional deep-link content id, forwarded as the `contentId` query param on the local ECP request. */
    contentId?: string;
    /** An optional deep-link media type, forwarded as the `mediaType` query param on the local ECP request. */
    mediaType?: string;
    /** Additional deep-link params, forwarded as-is as query params on the local ECP request. */
    params?: Record<string, string>;
}

export interface ExitAppOptions extends BaseEcpOptions {
    /** The channel id to exit (for example 'dev' for the sideloaded dev channel). */
    appId: string;
    /**
     * When true, appends `/true` to the local ECP request, matching `exit-app/{appId}/true`.
     * Has no effect on RCE devices, since the ECP2 'exit-app' verb has no force concept.
     */
    force?: boolean;
}

export interface GetFilePathsOptions {
    files: FileEntry[];
    rootDir: string;
}

export interface StageOptions {
    rootDir?: string;
    files?: FileEntry[];
    /**
     * The output directory where staged files will be placed
     */
    out?: string;
    cwd?: string;
}

export interface ZipOptions {
    /**
     * The directory containing the files to be zipped
     */
    dir: string;
    /**
     * An optional array of file patterns to include in the zip.
     * If not provided, defaults to all files (`**\/*`).
     */
    files?: FileEntry[];
    /**
     * The output zip file path (e.g., './out/roku-deploy.zip')
     */
    out?: string;
    cwd?: string;
}

type BaseSideloadOptions = BaseRequestOptions & BaseEcpOptions & {
    appType?: 'channel' | 'dcl';
    close?: boolean;
    remoteDebug?: boolean;
    remoteDebugConnectEarly?: boolean;
    failOnCompileError?: boolean;
    deleteDevChannel?: boolean;
    cwd?: string;
    packageUploadOverrides?: PackageUploadOverridesOptions;
};

export type SideloadOptions = BaseSideloadOptions & (
    | { zip: string; dir?: never }
    | { dir: string; zip?: never }
);

export interface PackageUploadOverridesOptions {
    route?: string;
    formData?: Record<string, any>;
}

export interface BaseRequestOptions {
    device: DeviceOption;
    username?: string;
    password: string;
    packagePort?: number;
    timeout?: number;
}

export interface BaseEcpOptions {
    device: DeviceOption;
    ecpPort?: number;
    /** Request timeout in milliseconds. Defaults to `RokuDeploy.defaults.ecpTimeout` (10 seconds) */
    timeout?: number;
}

export interface EcpOptions {
    /** The http method for the route; queries are GETs (the default), commands like keypress and launch are POSTs */
    method?: 'GET' | 'POST';
    /**
     * Run the standard response verification (throw on non-200 statuses and error bodies).
     * Defaults to false so raw ECP status bodies (a 202 `FAILED` registry response, for example)
     * come back to the caller instead of throwing.
     */
    verify?: boolean;
    /** The ECP port for local devices (defaults to 8060); not used for Cloud Emulator devices */
    ecpPort?: number;
    /** Request timeout in milliseconds. Defaults to `RokuDeploy.defaults.ecpTimeout` (10 seconds) */
    timeout?: number;
}

export interface EcpResult {
    /** The http status code of the response, or undefined when the transport produced no response */
    status: number | undefined;
    /** The raw response body (usually XML, empty for command routes like keypress) */
    body: string;
    /**
     * The XML response body parsed to a plain object (keyed by the XML root element), or undefined
     * when the response had no XML body
     */
    json: Record<string, any> | undefined;
}

export interface QueryRegistryOptions extends BaseEcpOptions {
    /** The app whose registry to query (for example `dev` for the sideloaded app) */
    appId: string;
}

export interface RokuRegistry {
    /** The developer id the device is keyed with */
    devId?: string;
    /** The app ids sharing this registry */
    plugins?: string[];
    /** Remaining registry space, in bytes (as reported by the device) */
    spaceAvailable?: string;
    /** Registry entries, keyed by section name then item key */
    sections: Record<string, Record<string, string>>;
}

export interface QueryAppStateOptions extends BaseEcpOptions {
    /** The app whose state to query (for example `dev` for the sideloaded app) */
    appId: string;
}

export type RokuAppStateValue = 'active' | 'background' | 'inactive' | 'unknown';

export interface RokuAppState {
    appId?: string;
    appDevId?: string;
    appTitle?: string;
    appVersion?: string;
    state: RokuAppStateValue;
}

export type QueryRendezvousOptions = BaseEcpOptions;

export interface RokuRendezvous {
    trackingEnabled: boolean;
    /** Rendezvous events recorded since the last query */
    items: RokuRendezvousItem[];
}

export interface RokuRendezvousItem {
    id: string;
    /** Event start time, in seconds (as reported by the device) */
    startTime: string;
    /** Event end time, in seconds (as reported by the device) */
    endTime: string;
    lineNumber: string;
    file: string;
}

export interface SetRendezvousTrackingOptions extends BaseEcpOptions {
    enabled: boolean;
}

export type ConvertToSquashfsOptions = BaseRequestOptions;

export interface RekeyDeviceOptions extends BaseRequestOptions {
    pkg: string;
    signingPassword: string;
    /**
     * If specified, rekeying will fail if the resulting devId is different than this value
     */
    devId?: string;
    cwd?: string;
}

export interface CreateSignedPackageOptions extends BaseRequestOptions {
    signingPassword: string;
    appTitle?: string;
    appVersion?: string;
    manifestPath?: string;
    /**
     * The output pkg file path (e.g., './out/roku-deploy.pkg')
     */
    out?: string;
    /**
     * If specified, signing will fail if the device's devId is different than this value
     */
    devId?: string;
    cwd?: string;
}

export type DeleteDevChannelOptions = BaseRequestOptions;

export type RebootDeviceOptions = BaseRequestOptions;

export type CheckForUpdateOptions = BaseRequestOptions;

export interface GetStagingDirOptions {
    /**
     * The staging folder path. When provided, this wins over `outDir`.
     */
    out?: string;
    /**
     * The output directory that contains the default staging folder. Defaults to `'./out'`.
     */
    outDir?: string;
    /**
     * The current working directory to use for relative paths
     */
    cwd?: string;
}

export interface GetOutputPathOptions {
    /**
     * The output file path. When provided, this wins over `outDir`/`outFile`.
     */
    out?: string;
    /**
     * The output directory. Defaults to `'./out'`.
     */
    outDir?: string;
    /**
     * The output file name. Defaults to `'roku-deploy.zip'`.
     */
    outFile?: string;
    /**
     * The current working directory to use for relative paths
     */
    cwd?: string;
}

export interface DeployOptions extends BaseRequestOptions {
    files?: FileEntry[];
    rootDir?: string;
    stagingDir?: string;
    deleteDevChannel?: boolean;
    out?: string;
    cwd?: string;
}

export type GetDevIdOptions = BaseEcpOptions;

export interface DeleteComponentLibraryOptions extends BaseRequestOptions {
    /**
     * The filename of the component library to delete
     */
    fileName: string;
}

export type DeleteAllComponentLibrariesOptions = BaseRequestOptions;

export type GetInstalledPackagesOptions = BaseRequestOptions;

export interface LoadConfigFileOptions {
    /**
     * The current working directory to use for relative paths
     */
    cwd?: string;
    /**
     * Path to the config file. Defaults to `rokudeploy.json` in the cwd.
     */
    configPath?: string;
}

export interface ZipResult {
    /**
     * The path to the created zip file
     */
    zipPath: string;
}

export interface CreateSignedPackageResult {
    /**
     * The path to the created signed package file
     */
    pkgPath: string;
}

export interface StageResult {
    /**
     * The path to the staging directory
     */
    stagingDir: string;
}

export interface GetDevIdResult {
    /**
     * The developer ID from the device
     */
    devId: string;
}

//create a new static instance of RokuDeploy, and export those functions for backwards compatibility
export const rokuDeploy = new RokuDeploy();
export type EcpNetworkAccessMode = 'enabled' | 'disabled' | 'limited' | 'permissive';

export interface RokuAppDescriptor {
    /** The channel id, for example 'dev' for the sideloaded dev channel. */
    id: string;
    /** The channel's display title. */
    title: string;
    /** The channel type, for example 'appl' for a sideloaded channel. */
    type?: string;
    /** The channel subtype, for example 'sdka' or 'rsga'. */
    subtype?: string;
    /** The channel version. */
    version?: string;
}

export interface RokuActiveApp {
    /**
     * The active channel's id. Undefined when the active "app" is the Roku home screen or a screensaver,
     * which have no id.
     */
    id?: string;
    /** The active channel's display title, or the home screen / screensaver's title text. */
    title?: string;
    /** The active channel's type, for example 'appl' for a sideloaded channel. */
    type?: string;
    /** The active channel's subtype, for example 'sdka' or 'rsga'. */
    subtype?: string;
    /** The active channel's version. */
    version?: string;
}
