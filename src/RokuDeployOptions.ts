import type { LogLevel } from './Logger';

export interface RokuDeployOptions {
    /**
     * Path to a bsconfig.json project file
     */
    project?: string;

    /**
     * A full path to the folder where the zip/pkg package should be placed
     * @default './out'
     */
    outDir?: string;

    /**
     * The base filename the zip/pkg file should be given (excluding the extension)
     * @default 'roku-deploy'
     */
    outFile?: string;

    /**
     * The root path to the folder holding your Roku project's source files (manifest, components/, source/ should be directly under this folder)
     * @default './'
     */
    rootDir?: string;

    /**
     * An array of source file paths, source file globs, or {src,dest} objects indicating
     * where the source files are and where they should be placed
     * in the output directory
     * @default [
            'source/**\/*.*',
            'components/**\/*.*',
            'images/**\/*.*',
            'manifest'
        ],
     */
    files?: FileEntry[];

    /**
     * Set this to true to prevent the staging folder from being deleted after creating the package
     * @default false
     */
    retainStagingDir?: boolean;

    /**
     * Should the zipped package be retained after deploying to a roku. If false, this will delete the zip after a deployment.
     * @default true
     */
    retainDeploymentArchive?: boolean;

    /**
     * The path where roku-deploy should stage all of the files right before being zipped. defaults to ${outDir}/.roku-deploy-staging
     * @deprecated since 3.9.0. use `stagingDir` instead
     */
    stagingFolderPath?: string;

    /**
     * The path where roku-deploy should stage all of the files right before being zipped. defaults to ${outDir}/.roku-deploy-staging
     */
    stagingDir?: string;

    /**
     * The IP address or hostname of the target Roku device.
     * @example '192.168.1.21'
     */
    host?: string;

    /**
     * The port that should be used when installing the package. Defaults to 80.
     * This is mainly useful for things like emulators that use alternate ports,
     * or when publishing through some type of port forwarding configuration.
     */
    packagePort?: number;

    /**
     * When publishing a side loaded channel this flag can be used to enable the socket based BrightScript debug protocol. Defaults to false.
     * More information on the BrightScript debug protocol can be found here: https://developer.roku.com/en-ca/docs/developer-program/debugging/socket-based-debugger.md
     */
    remoteDebug?: boolean;

    /**
     * When publishing a sideloaded channel, this flag can be used to tell the Roku device that, should any compile errors occur, a client device (such as vscode)
     * will be trying to attach to the debug protocol control port to consume those compile errors. This must be used in conjuction with the `remoteDebug` option
     */
    remoteDebugConnectEarly?: boolean;

    /**
     * The port used to send remote control commands (like home press, back, etc.). Defaults to 8060.
     * This is mainly useful for things like emulators that use alternate ports,
     * or when sending commands through some type of port forwarding.
     */
    remotePort?: number;

    /**
     * The request timeout duration in milliseconds. Defaults to 150000ms (2 minutes 30 seconds).
     * This is mainly useful for preventing hang ups if the Roku loses power or restarts due to a firmware bug.
     * This is applied per network request to the device and does not apply to the total time it takes to completely execute a call to roku-deploy.
     */
    timeout?: number;

    /**
     * The username for the roku box. This will always be 'rokudev', but allows to be overridden
     * just in case roku adds support for custom usernames in the future
     * @default 'rokudev'
     */
    username?: string;

    /**
     * The password for logging in to the developer portal on the target Roku device
     */
    password?: string;

    /**
     * The password used for creating signed packages
     */
    signingPassword?: string;

    /**
     * Path to a copy of the signed package you want to use for rekeying
     */
    rekeySignedPackage?: string;

    /**
     * Dev ID we are expecting the device to have. If supplied we check that the dev ID returned after keying matches what we expected
     */
    devId?: string;

    /**
     * If true we increment the build number to be a timestamp in the format yymmddHHMM
     */
    incrementBuildNumber?: boolean;

    /**
     * If true we convert to squashfs before creating the pkg file
     */
    convertToSquashfs?: boolean;

    /**
     * If true, the publish will fail on compile error
     */
    failOnCompileError?: boolean;

    /**
     * The log level.
     * @default LogLevel.log
     */
    logLevel?: LogLevel;

    /**
     * If true, the previously installed dev channel will be deleted before installing the new one
     */
    deleteInstalledChannel?: boolean;
}

export type FileEntry = (string | { src: string | string[]; dest?: string });
