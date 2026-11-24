# roku-deploy

Publish Roku projects to a Roku device by using Node.js.

[![build status](https://img.shields.io/github/actions/workflow/status/rokucommunity/roku-deploy/build.yml?branch=master)](https://github.com/rokucommunity/roku-deploy/actions?query=branch%3Amaster+workflow%3Abuild)
[![coverage status](https://img.shields.io/coveralls/github/rokucommunity/roku-deploy?logo=coveralls)](https://coveralls.io/github/rokucommunity/roku-deploy?branch=master)
[![monthly downloads](https://img.shields.io/npm/dm/roku-deploy.svg?sanitize=true&logo=npm&logoColor=)](https://npmcharts.com/compare/roku-deploy?minimal=true)
[![npm version](https://img.shields.io/npm/v/roku-deploy.svg?logo=npm)](https://www.npmjs.com/package/roku-deploy)
[![license](https://img.shields.io/github/license/rokucommunity/roku-deploy.svg)](LICENSE)
[![Slack](https://img.shields.io/badge/Slack-RokuCommunity-4A154B?logo=slack)](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA)

### Table of Contents
- [Installation](#installation)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Devices](#devices)
- [CLI Usage](#cli-usage)
- [JavaScript Usage](#javascript-usage)
- [Options Priority Order](#options-priority-order)
- [Timeouts](#timeouts)
- [Files Array](#files-array)
- [Upgrading to v4](#upgrading-to-v4)
- [User-agent](#user-agent)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

## Installation

    npm install roku-deploy

## Requirements

Your project must be structured the way that Roku expects. The source files can be in a subdirectory (using the `rootDir` config option), but wherever your roku files exist, they must align with the following folder structure:

    components/
    images/
    source/
    manifest
    locale/
    fonts/

## Quick start

Create a config file in your project root, fill in your device, then sideload:

```shell
npx roku-deploy init
```

```jsonc
// rokudeploy.json
{
    "device": { "host": "192.168.1.101" },
    "password": "securePassword"
}
```

```shell
# zip the project folder and install it on the device
npx roku-deploy sideload --dir ./

# install, convert to squashfs and download a signed package in one command
npx roku-deploy package --sideload --dir ./ --signingPassword 'signing password' --manifestPath ./manifest
```

Every command accepts `--help`. When a config file is found, the help output names the file and lists the keys it sets, so you can see what a command is about to use without opening the file.

## Configuration

roku-deploy reads a `rokudeploy.json` from the current directory (or the file given with `--config`). The file is a single flat set of values; each command reads the ones it needs. It is jsonc, so comments and trailing commas are allowed.

```jsonc
{
    "device": { "host": "192.168.1.101" },
    "password": "securePassword",
    "rootDir": "./src",
    "signingPassword": "signing password"
}
```

To start from a fully-commented file that lists every key (all commented out, `tsc --init` style), run `npx roku-deploy init`. It writes [rokudeploy.json](src/rokudeploy.sample.jsonc) to the current directory; pass `--force` to overwrite an existing file and `--cwd` to write it elsewhere.

### Config keys

| Key | Read by | Description |
|---|---|---|
| `device` | all device commands | The target device, as an inline device config. See [Devices](#devices). |
| `host` | all device commands | Shorthand for `device: { host }`. |
| `password` | all device commands | The password of the developer web server on the device. |
| `username` | all device commands | Defaults to `rokudev`. Only here in case Roku ever supports other usernames. |
| `packagePort` | all device commands | The port of the device's developer web server (sideload, package, reboot). Defaults to `80`. |
| `ecpPort` | remote-control commands, `sideload --close` | The port for ECP commands such as key presses. Defaults to `8060`. |
| `rceToken` | Roku Cloud Emulator devices | The default bearer token for RCE devices whose config carries none of its own. |
| `rootDir` | `stage` | The folder holding your source. The manifest lives directly under it. |
| `files` | `stage` | Globs relative to `rootDir`, or `{ src, dest }` objects. See [Files Array](#files-array). Not used by `zip`, which takes its own `--files`. |
| `stagingDir` | `stage` | Where the filtered copy of `rootDir` is written. |
| `outDir` / `outFile` | `zip`, `package` | Output folder and base file name. `zip` writes `<outDir>/<outFile>.zip`; `package` writes the signed `.pkg`. The CLI `--out` sets both at once. |
| `signingPassword` | `package`, `rekey` | The signing password of the key on the device. |
| `convertToSquashfs` | `package` | Convert the installed channel to squashfs before packaging. Defaults to `true`. The CLI flag is `--squash` / `--no-squash`. |
| `rekeySignedPackage` | `rekey`, `sideload --rekey`, `package --rekey` | A previously signed `.pkg` whose key should be installed on the device. The CLI flag is `--pkg`. |
| `devId` | `rekey`, `package` | Expected dev ID; the run fails if the device ends up with a different one. |
| `logLevel` | all commands | One of `off`, `error`, `warn`, `log`, `info`, `debug`, `trace`. |

Config keys use the method option names. A few CLI flags differ: `--squash` sets `convertToSquashfs`, `--pkg` sets `rekeySignedPackage`, and `--out` sets `outDir` / `outFile`.

CLI arguments override the file, and the file overrides the built-in defaults. Pass `--no-config` to skip the file entirely, or `--config ./other.json` to read a different one. A `rokudeploy.json` left in a folder is picked up by every command run there, including the test suite of a project that lives in that folder.

### Config in the Node API

Library calls never read a config file on their own. Load one with `loadConfigFile()` and spread it into each call:

```typescript
import { rokuDeploy } from 'roku-deploy';

const config = rokuDeploy.loadConfigFile();
await rokuDeploy.sideload({ ...config, dir: './' });
await rokuDeploy.stage({ ...config });
```

`loadConfigFile()` reads `rokudeploy.json` from the current directory and returns its values as a plain object, empty when the file is missing. Pass `{ configPath }` to read a specific file or `{ cwd }` to resolve from another folder; path-valued keys such as `rootDir` are resolved against the file's location. Anything you pass alongside the spread wins, so a call option always overrides a file value.

The constructor accepts the connection-related keys (`device`, `devices`, `password`, `username`, `packagePort`, `ecpPort`, `rceToken`, `logger`) when you want them as instance defaults. The per-command keys such as `rootDir`, `files` and `signingPassword` are passed to the call.

## Devices

A device is either a Roku on your network or a Roku Cloud Emulator (RCE) instance. A device config carries exactly one address:

| Address | Device | Example |
|---|---|---|
| `host` | local Roku | `{ "host": "192.168.1.101" }` |
| `esn` | RCE device by serial number | `{ "esn": "X123456789", "rceToken": "..." }` |
| `id` | RCE device by its management-api id | `{ "id": 42 }` |
| `instanceUrl` | a running RCE instance | `{ "instanceUrl": "https://..." }` |

RCE devices need a bearer token: put `rceToken` on the device config, or set a default `rceToken` at the top level of the config file or on the constructor.

On the command line, every device command takes `--host`, `--esn` or `--instanceUrl` (exactly one), plus `--rceToken` for RCE devices. These override the `device` in the config file. The developer `--password` is separate from the device address.

In the Node API, `device` is either an inline config or the name of an entry in a `devices` registry passed to the constructor. Registry entries can also carry per-device settings:

```typescript
const rd = new RokuDeploy({
    password: 'shared-password',
    devices: {
        'living-room': { host: '192.168.1.21' },
        'office-tv': { host: '192.168.1.22', password: 'other-password', packagePort: 8080 },
        'ci-emulator': { esn: 'X123456789', rceToken: process.env.RCE_TOKEN }
    }
});
await rd.sideload({ device: 'office-tv', dir: './' });
```

When a call targets a registry entry by name, that entry's `password`, `username`, `packagePort`, `ecpPort` and `timeout` apply after the constructor options and before the options passed to the call. An inline device config carries only the address, so put the password at the top level or on a registry entry, not inside the device object.

## CLI Usage

Run `npx roku-deploy --help` for the command list and `npx roku-deploy <command> --help` for a command's options. Help groups options by the step they belong to, and `--version` is accepted only at the root. Unknown commands and options are rejected.

Two options are accepted by every command:
- `--config <path>`: the config file to read (defaults to `rokudeploy.json` in cwd). `--no-config` skips the file.
- `--logLevel <level>`: `off`, `error`, `warn`, `log`, `info`, `debug` or `trace`. Falls back to `logLevel` in the config file.

The examples below pass `--host` and `--password` for clarity. With a config file present you can leave them out.

### Create a config file
```shell
npx roku-deploy init
npx roku-deploy init --force
```

### Sideload a project to your Roku device
Sideload a .zip or a folder. By default the running channel is closed first and the existing dev channel is removed before installing.
```shell
# Sideload a zip file
npx roku-deploy sideload --host 'ip.of.roku' --password 'password' --zip './path/to/your/app.zip'

# Sideload from a directory (zipped first automatically)
npx roku-deploy sideload --host 'ip.of.roku' --password 'password' --dir './path/to/your/project'

# Keep the running channel open, keep the existing dev channel
npx roku-deploy sideload --host 'ip.of.roku' --password 'password' --zip './app.zip' --no-close --no-deleteDevChannel

# Install the signing key from a signed package first, then sideload
npx roku-deploy sideload --host 'ip.of.roku' --password 'password' --dir './project' --rekey --pkg './keys/signed.pkg' --signingPassword 'signing password'
```

Other sideload options: `--appType dcl` to install a Device Component Library, `--failOnCompileError` (on by default), `--remoteDebug` and `--remoteDebugConnectEarly` for editor integrations, `--ecpPort` for the close step, and `--packagePort` for the installer.

### Create a signed package
`package` signs the channel installed on the device and downloads the `.pkg`. By default it converts the installed channel to squashfs first. The optional steps run before it, always in this order: rekey, sideload, squash.
```shell
# Package the channel that is already installed (squashes it first)
npx roku-deploy package --host 'ip.of.roku' --password 'password' --signingPassword 'signing password' --manifestPath './manifest' --out './out/my-app.pkg'

# Sideload a folder, then squash and package it
npx roku-deploy package --host 'ip.of.roku' --password 'password' --sideload --dir './project' --signingPassword 'signing password' --manifestPath './manifest'

# Skip the squashfs conversion
npx roku-deploy package --host 'ip.of.roku' --password 'password' --no-squash --signingPassword 'signing password' --manifestPath './manifest'

# Rekey the device, sideload, squash and package in one run
npx roku-deploy package --host 'ip.of.roku' --password 'password' --rekey --pkg './keys/signed.pkg' --sideload --dir './project' --signingPassword 'signing password' --manifestPath './manifest'
```

The package title and version come from `--manifestPath`, or pass both `--appTitle` and `--appVersion`. `--signingPassword` and `--devId` are shared by the rekey and package steps. When `--sideload` is given, `package` accepts sideload's inputs too (`--zip`, `--dir`, `--close`, `--failOnCompileError`, `--deleteDevChannel`, `--appType`).

### Stage files to a directory
Copy the files selected by the [files array](#files-array) from `rootDir` to a staging folder:
```shell
npx roku-deploy stage --rootDir './path/to/root/dir' --out './path/to/staging/dir'
```

### Zip a directory
```shell
npx roku-deploy zip --dir './path/to/directory' --out './path/to/output.zip'

# only some of the files
npx roku-deploy zip --dir './staging' --out './out/app.zip' --files 'source/**/*' 'manifest'
```
`zip` does not read the `files` array from the config file; pass `--files` if you need a filter.

### Remote control commands
```shell
# Press a key
npx roku-deploy keyPress --key 'Home' --host 'ip.of.roku'

# Hold a key down
npx roku-deploy keyDown --key 'Up' --host 'ip.of.roku'

# Release a key
npx roku-deploy keyUp --key 'Up' --host 'ip.of.roku'

# Send text to the device
npx roku-deploy sendText --text 'Hello World' --host 'ip.of.roku'

# Interactive remote control mode (keyboard input is sent as key presses until Ctrl+C)
npx roku-deploy remote-control --host 'ip.of.roku'
```

### Convert to SquashFS
```shell
npx roku-deploy squash --host 'ip.of.roku' --password 'password'
```

### Rekey a device
Install the signing key from a previously signed package. Pass `--devId` to fail if the device ends up with a different dev ID than you expect.
```shell
npx roku-deploy rekey --host 'ip.of.roku' --password 'password' --pkg './path/to/signed.pkg' --signingPassword 'signing password'
```

### Device management
```shell
# Take a screenshot (filename used exactly as provided)
npx roku-deploy screenshot --host 'ip.of.roku' --password 'password' --out './screenshot.jpg'

# Take a screenshot and let the extension follow the device's image format
npx roku-deploy screenshot --host 'ip.of.roku' --password 'password' --out './screenshot' --autoExtension

# Delete the dev channel
npx roku-deploy deleteDevChannel --host 'ip.of.roku' --password 'password'

# Get device information (ECP, no password needed)
npx roku-deploy getDeviceInfo --host 'ip.of.roku'

# Get the device's dev ID (ECP, no password needed)
npx roku-deploy getDevId --host 'ip.of.roku'
```

### Roku Cloud Emulator devices
Target an RCE device with `--esn` or `--instanceUrl` instead of `--host`, plus a token:
```shell
npx roku-deploy sideload --esn 'X123456789' --rceToken "$RCE_TOKEN" --password 'password' --dir './project'
```

Boot and shut down RCE devices through the management api:
```shell
# Boot from the live snapshot and wait until it is running
npx roku-deploy rce start --esn 'X123456789' --token "$RCE_TOKEN" --wait

# Boot a named snapshot, limit the runtime to one hour
npx roku-deploy rce start --deviceId 42 --snapshot 'my-snapshot' --maxRuntime 3600

# Shut down
npx roku-deploy rce stop --esn 'X123456789' --wait
```
`--token` falls back to `rceToken` in the config file. For `rce start` and `rce stop`, `--timeout` is how long `--wait` polls, in seconds.

### Running roku-deploy as an npm script
```json
{
    "scripts": {
        "deploy": "roku-deploy sideload --dir ./",
        "package": "roku-deploy package --sideload --dir ./ --manifestPath ./manifest"
    }
}
```
The device and passwords come from `rokudeploy.json` next to `package.json`.

## JavaScript Usage

```typescript
import { rokuDeploy, RokuDeploy } from 'roku-deploy';
```

`rokuDeploy` is a ready-made instance. Create your own with `new RokuDeploy(options)` when you want instance defaults (a device, a password, a registry, or a logger) merged into every call. Every method takes a single options object and returns a result object.

### Instance defaults
```typescript
const rd = new RokuDeploy({
    device: { host: '192.168.1.101' },
    password: 'password'
    // see "Config in the Node API" to load these from rokudeploy.json
});
await rd.keyPress({ key: 'Home' });
```

### Copying the files to staging
```typescript
const { stagingDir } = await rokuDeploy.stage({
    rootDir: 'folder/with/your/source/code',
    out: 'path/to/staging/folder',
    files: [
        'source/**/*',
        'components/**/*',
        'images/**/*',
        'manifest',
        'locale/**/*',
        'fonts/**/*'
    ]
});
```

### Creating a zip from a folder
```typescript
const { zipPath } = await rokuDeploy.zip({
    dir: 'path/to/staging/folder',
    out: 'folder/to/put/zip/my-app.zip',
    // optional filter; defaults to every file in `dir`
    files: ['**/*']
});
```

### Sideloading a project
The running channel is closed first and the existing dev channel is removed before installing. Pass `close: false` or `deleteDevChannel: false` to skip either.
```typescript
// from a zip file
await rokuDeploy.sideload({
    device: { host: '192.168.1.101' },
    password: 'password',
    zip: './path/to/your/app.zip'
});

// from a folder (zipped automatically)
await rokuDeploy.sideload({
    device: { host: '192.168.1.101' },
    password: 'password',
    dir: './path/to/your/project'
});
```

### Convert to SquashFS
```typescript
await rokuDeploy.convertToSquashfs({
    device: { host: '192.168.1.101' },
    password: 'password'
});
```

### Create a signed package
```typescript
const { pkgPath } = await rokuDeploy.createSignedPackage({
    device: { host: '192.168.1.101' },
    password: 'password',
    signingPassword: 'signing password',
    manifestPath: './manifest',       // or appTitle + appVersion
    out: './out/my-app.pkg',
    devId: 'expected-dev-id'          // optional guard
});
```

### Rekey a device
```typescript
await rokuDeploy.rekeyDevice({
    device: { host: '192.168.1.101' },
    password: 'password',
    pkg: './path/to/signed.pkg',
    signingPassword: 'signing password'
});
```

### Remote control
```typescript
await rokuDeploy.keyPress({ device: { host: '192.168.1.101' }, key: 'Home' });
await rokuDeploy.sendText({ device: { host: '192.168.1.101' }, text: 'Hello World' });
await rokuDeploy.sendKeySequence({ device: { host: '192.168.1.101' }, keys: ['Home', 'Down', 'Select'] });
await rokuDeploy.openSecretScreen({ device: { host: '192.168.1.101' }, screen: 'secret-screen' });
await rokuDeploy.launchApp({ device: { host: '192.168.1.101' }, appId: 'dev', contentId: 'episode-1' });
```

### Take a screenshot
```typescript
// returns the image buffer and format; also writes the file when `out` is given
const { buffer, format, filePath } = await rokuDeploy.captureScreenshot({
    device: { host: '192.168.1.101' },
    password: 'password',
    out: './screenshots/screenshot.jpg',
    // with autoExtension: true the extension follows the device's image format
    autoExtension: false
});
```

### Device information
```typescript
const info = await rokuDeploy.getDeviceInfo({ device: { host: '192.168.1.101' }, enhance: true });
const { devId } = await rokuDeploy.getDevId({ device: { host: '192.168.1.101' } });
await rokuDeploy.deleteDevChannel({ device: { host: '192.168.1.101' }, password: 'password' });
```

### Errors
Every error roku-deploy throws is a `RokuDeployError` subclass with a `code`, and carries the underlying error as `cause` and any HTTP exchange as `details.httpDetails`. For example, `stage()` throws a `NoFilesStagedError` when the files array matches nothing, which usually means the wrong `rootDir`. Import the classes from the package to narrow on them:
```typescript
import { CompileError, FailedDeviceResponseError } from 'roku-deploy';
```

### All public methods
Can't find what you need? Every public method lives in [RokuDeploy.ts](https://github.com/rokucommunity/roku-deploy/blob/v4/src/RokuDeploy.ts):

- Building: `stage()`, `zip()`, `resolveFilesArray()`, `getDestPath()`
- Installing: `sideload()`, `convertToSquashfs()`, `createSignedPackage()`, `rekeyDevice()`, `deleteDevChannel()`, `deleteAllSideloadedPlugins()`, `deleteComponentLibrary()`, `deleteAllComponentLibraries()`, `listSideloadedPlugins()`
- Device: `getDeviceInfo()`, `getDevId()`, `getEcpNetworkAccessMode()`, `captureScreenshot()`, `rebootDevice()`, `checkForUpdate()`, `validateDeveloperPassword()`
- Remote control: `keyPress()`, `keyDown()`, `keyUp()`, `sendText()`, `sendKeySequence()`, `openSecretScreen()`, `closeChannel()`, `launchApp()`, `exitApp()`
- ECP queries: `getApps()`, `getActiveApp()`, `getRegistry()`, `getAppState()`, `getRendezvousTracking()`, `setRendezvousTracking()`, `sendEcpRequest()`, `createEcpSocket()`, `createSocket()`
- Profiling: `enablePerfettoTracing()`, `startPerfettoSession()`, `triggerHeapSnapshot()`
- Config: `loadConfigFile()`

The `RceManagementClient` export drives the Roku Cloud Emulator management api (start and stop devices, list snapshots) and is what the `rce` CLI commands use.

## Options Priority Order

**From the CLI**, lowest to highest:
1. the built-in defaults
2. values in `rokudeploy.json` (or the `--config` file)
3. CLI arguments

**From JavaScript**, lowest to highest:
1. the built-in defaults
2. options passed to the constructor
3. per-device settings of the registry entry a call targets by name
4. options passed to the method call

## Timeouts

Each request to the device has its own default timeout, chosen for the kind of work it does:

| Default | Applies to |
|---|---|
| 10 seconds | quick requests: device info, key presses, reboot, update check, channel delete, password check |
| 5 minutes | long-running on-device work: sideload, package, convert to squashfs, rekey |

Pass `timeout` (milliseconds) on a call, a registry entry, or `--timeout` on the CLI to override the default for that request. The value applies per request, not to the whole command, so a `package --sideload` run may take longer than one timeout. There is no longer a single global timeout option.

## Files Array

The files array is how you specify what files are included in your project. Any strings found in the files array must be relative to `rootDir`, and are used as include _filters_, meaning that if a file matches the pattern, it is included. It is read by `stage`; `zip` takes its own `--files` filter instead.

For most standard projects, the default files array should work just fine:

```jsonc
{
    "files": [
        "source/**/*.*",
        "components/**/*.*",
        "images/**/*.*",
        "locale/**/*",
        "fonts/**/*",
        "manifest",
        "!node_modules",
        "!**/*.{md,DS_Store,db}"
    ]
}
```

This will copy all files from the standard roku folders directly into the package while maintaining each file's relative file path within `rootDir`.

If you want to include additional files, you will need to provide the entire array. For example, if you have a folder with other assets, you could do the following:

```jsonc
{
    "files": [
        "source/**/*.*",
        "components/**/*.*",
        "images/**/*.*",
        "locale/**/*",
        "fonts/**/*",
        "manifest",
        "!node_modules",
        "!**/*.{md,DS_Store,db}",
        //your folder with other assets
        "assets/**/*"
    ]
}
```

### Excluding Files
You can also prefix your file patterns with "`!`" which will _exclude_ files from the output. This is useful in cases where you want everything in a folder EXCEPT certain files. The files array is processed top to bottom. Here's an example:

```jsonc
{
    "files": [
        "source/**/*",
        "!source/some/unwanted/file.brs"
    ]
}
```

#### Top-level String Rules
 - All patterns will be resolved relative to `rootDir`, with their relative positions within `rootDir` maintained.

 - No pattern may reference a file outside of `rootDir`. (You can use `{src;dest}` objects to accomplish) For example:
     ```jsonc
     {
         "rootDir": "C:/projects/CatVideoPlayer",
         "files": [
             "source/main.brs",

             //NOT allowed because it navigates outside the rootDir
             "../common/promise.brs"
         ]
     }
     ```

 - Any valid glob pattern is supported. See [glob on npm](https://www.npmjs.com/package/glob) for more information.

 - Empty folders are not copied

 - Paths to folders will be ignored. If you want to copy a folder and its contents, use the glob syntax (i.e. `some_folder/**/*`)

 - You may use either forward slashes ( `/` ) or backslashes ( `\` ) as path separators; roku-deploy normalizes both, so patterns built with Node's `path.join` on Windows work as-is. Forward slashes are still recommended for portability.

 - Because a backslash is also the glob escape character, prefer the character-class form to match a literal glob metacharacter in a filename: use `[*]` / `[?]` rather than `\*` / `\?`.

 - **Folders or files with square brackets in their name** (e.g. `[ios]`, `[v2]`) are a common gotcha: unescaped square brackets are a glob _character class_ (`[abc]` means "one of `a`, `b`, `c`"), so `[v2]/*` will _not_ match a folder literally named `[v2]`, and may match unintended folders named `v` or `2`. Escape the brackets to match them literally:
     ```jsonc
     {
         "files": [
             //matches the folder literally named "[v2]"
             "\\[v2\\]/**/*"
         ]
     }
     ```
     roku-deploy preserves these `\[` / `\]` escapes even on Windows (where the backslash would otherwise look like a path separator). There is no character-class alternative for literal brackets, so the escape is required. See [how fast-glob handles patterns on Windows](https://www.npmjs.com/package/fast-glob?activeTab=readme#how-to-write-patterns-on-windows) for background.

### Advanced Usage
For more advanced use cases, you may provide an object which contains the source pattern and output path. This allows you to get very specific about what files to copy, and where they are placed in the output folder. This option also supports copying files from outside the project.

The object structure is as follows:

```typescript
{
    /**
     * a glob pattern string or file path, or an array of glob pattern strings and/or file paths.
     * These can be relative paths or absolute paths.
     * All non-absolute paths are resolved relative to the rootDir
     */
    src: Array<string|string[]>;
    /**
     * The relative path to the location in the output folder where the files should be placed, relative to the root of the output folder
     */
    dest: string|undefined
}
```
#### { src; dest } Object Rules
- if `src` is a non-glob path to a single file, then `dest` should include the filename and extension. For example:
`{ src: "lib/Promise/promise.brs", dest: "source/promise.brs"}`

 - if `src` is a glob pattern, then `dest` should be a path to the folder in the output directory. For example:
 `{ src: "lib/*.brs", dest: "source/lib"}`

 - if `src` is a glob pattern that includes `**`, then all files found in `src` after the `**` will retain their relative paths in `src` when copied to `dest`. For example:
 `{ src: "lib/**.brs", dest: "source/lib"}`

 - if `src` is a path to a folder, it will be ignored. If you want to copy a folder and its contents, use the glob syntax. The following example will copy all files from the `lib/vendor` folder recursively:
`{ src: "lib/vendor/**/*", dest: "vendor" }`

 - if `dest` is not specified, the root of the output folder is assumed

 - you can omit the filename in `dest` if you want the file to keep its name. Just end `dest` with a trailing slash:
 `{ src: "languages/english/language.xml", dest: "languages/" }`

#### Collision Handling
`roku-deploy` processes file entries in order, so if you want to override a file, just make sure the one you want to keep is later in the files array

For example, if you have a base project, and then a child project that wants to override specific files, you could do the following:
```jsonc
{
    "files": [
        {
            //copy all files from the base project
            "src": "../BaseProject/**/*"
        },
        //override "../BaseProject/themes/theme.brs" with "${rootDir}/themes/theme.brs"
        "themes/theme.brs"
    ]
}
```

## Upgrading to v4

v4 reshapes the CLI, the config file and the Node API. Here is what to change.

### The device is an object
`host` is gone as a standalone option. Give every call a `device`: an inline config such as `{ host: '192.168.1.101' }`, or the name of a registry entry. On the CLI, `--host` still works and is mapped onto `device` for you, and `--esn` / `--instanceUrl` target Roku Cloud Emulator devices. See [Devices](#devices).

### The config file is flat, and the Node API does not load it for you
`rokudeploy.json` is one flat set of keys read by every command; the per-command sections introduced during the alpha are gone, as is the `devices` registry in the file. Library calls no longer read any config file implicitly. Call `loadConfigFile()` and spread the result into each call. See [Config in the Node API](#config-in-the-node-api).

`bsconfig.json` is no longer read at all. Point `--config` or `loadConfigFile({ configPath })` at it if you still keep roku-deploy settings there.

### Renamed and removed Node API functions
| v3 | v4 |
|---|---|
| `publish()` | `sideload()` |
| `zipPackage()` | `zip()` |
| `signExistingPackage()` | `createSignedPackage()` |
| `deleteInstalledChannel()` | `deleteDevChannel()` |
| `takeScreenshot()` | `captureScreenshot()` |
| `pressHomeButton()` | `closeChannel()` |
| `getFilePaths()` | `resolveFilesArray()` |
| `loadOptionsFromJson()` / `getOptions()` | `loadConfigFile()`; there is no merged-defaults getter |
| `deploy()`, `createPackage()`, `deployAndSignPackage()` | the CLI's `package --sideload`; in code, call `sideload()`, `convertToSquashfs()` and `createSignedPackage()` in turn |

`convertToSquashfs()`, `rekeyDevice()`, `getDeviceInfo()`, `getDevId()`, `keyPress()`, `keyDown()`, `keyUp()` and `sendText()` keep their names. Every method takes one options object and returns a result object rather than a raw HTTP response, and all thrown errors carry a `code` and a `cause`.

### Option renames
- `pkg` is the signed package used for rekeying, on the CLI and in code.
- `screenshotDir` / `screenshotFile` are replaced by `out` on `captureScreenshot()` and `screenshot`.
- The global `timeout` default is gone; each kind of request has its own default and `timeout` on a call overrides it. See [Timeouts](#timeouts).
- `logLevel` is no longer a constructor option. Pass a `logger`, set `logLevel` in the config file, or use `--logLevel` on the CLI.

### CLI changes
- Unknown commands and options are rejected instead of ignored.
- `--version` is accepted only at the root (`roku-deploy --version`), not on subcommands.
- `sideload` gained `--rekey`; `package` gained `--rekey`, `--sideload` and `--squash` (on by default) and replaces the old `deploy` flows.
- `init` writes a fully-commented config file.

### Default files array changed
`node_modules` and static-analysis files are excluded to speed up load times, and `fonts/` and `locale/` are included. The new default array is in [Files Array](#files-array).

## User-agent
roku-deploy includes a User-Agent header to help you filter out unwanted network traffic from your network monitoring software of choice. The User-Agent header will be the name of the tool (`roku-deploy`) followed by the full version of the tool. If you're using a prerelease or temporary testing version, that information will also be included. Here are some examples:
```
User-Agent: roku-deploy/3.12.6
User-Agent: roku-deploy/4.0.0-alpha.12
User-Agent: roku-deploy/3.12.7-some-branch-name-123.3958293294854

```

If for some strange reason we were unable to find the version number, then the `User-Agent` will be:
```
User-Agent: roku-deploy/unknown
```

## Troubleshooting
 - if you see a `ESOCKETTIMEDOUT` error during deployment, this can be caused by an antivirus blocking network traffic, so consider adding a special exclusion for your Roku device.
 - if a command picks up values you did not expect, run it with `--help`: when a config file is found, the help names the file and lists the keys it sets. `--no-config` runs without any file.

## Changelog
Click [here](CHANGELOG.md) to view the changelog
