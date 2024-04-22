# roku-deploy

This is the V4 branch, it's a work in progress.

Publish Roku projects to a Roku device by using Node.js.

[![build status](https://img.shields.io/github/actions/workflow/status/rokucommunity/roku-deploy/build.yml?branch=master)](https://github.com/rokucommunity/roku-deploy/actions?query=branch%3Amaster+workflow%3Abuild)
[![coverage status](https://img.shields.io/coveralls/github/rokucommunity/roku-deploy?logo=coveralls)](https://coveralls.io/github/rokucommunity/roku-deploy?branch=master)
[![monthly downloads](https://img.shields.io/npm/dm/roku-deploy.svg?sanitize=true&logo=npm&logoColor=)](https://npmcharts.com/compare/roku-deploy?minimal=true)
[![npm version](https://img.shields.io/npm/v/roku-deploy.svg?logo=npm)](https://www.npmjs.com/package/roku-deploy)
[![license](https://img.shields.io/github/license/rokucommunity/roku-deploy.svg)](LICENSE)
[![Slack](https://img.shields.io/badge/Slack-RokuCommunity-4A154B?logo=slack)](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA)
## Installation

    npm install roku-deploy

## Requirements

1. Your project must be structured the way that Roku expects. The source files can be in a subdirectory (using the `rootDir` config option), but whever your roku files exist, they must align with the following folder structure:

    components/
    images/
    source/
    manifest

2. You should create a rokudeploy.json file at the root of your project that contains all of the overrides to the default options. roku-deploy will auto-detect this file and use it when possible. (**note**: `rokudeploy.json` is jsonc, which means it supports comments).

sample rokudeploy.json

```jsonc
{
    "host": "192.168.1.101",
    "password": "securePassword"
}
```
## CLI Usage

### Deploy a zip package
Deploy a .zip package of your project to a roku device
```shell
npx roku-deploy deploy --host ${ip-of-roku} --password ${password} --rootDir '.' --outDir './out'
```


### Create a signed package of your project
```shell
npx roku-deploy deploy package --host ${ip-of-roku} --password ${password} --signingPassword ${signing-password}
```

### Other uses
Stage the root directory
```shell
npx roku-deploy stage --stagingDir ${stagingDir} --rootDir ${rootDir}
```
Zip the contents of a given directory
```shell
npx roku-deploy zip --stagingDir ${rootDir} --outDir ${outDir}
```
Press the Home key
```shell
npx roku-deploy keyPress --key 'Home' --host ${ip-of-roku} --remotePort ${remotePort} --timeout ${timeout}
```
Sideload a build
```shell
npx roku-deploy sideload --host ${ip-of-roku} --password ${password} --outDir ${outDir} 
```

Convert to SquashFS
```shell
npx roku-deploy squash --host ${ip-of-roku} --password ${password}
```

```shell
npx roku-deploy sign --host ${ip-of-roku} --password ${password}
```
sign

Here are all the possible cli commands:
- bundle
- deploy
- package
- exec
- keypress
- keyup
- keydown
- sendText
- stage
- sideload
- squash
- rekey
- createSignedPackage
- deleteDevChannel
- screenshot
- getDeviceInfo
- getDevId
- zip


## Node script Usage

### Copying the files to staging
If you'd like to use roku-deploy to copy files to a staging folder, you can do the following:
```typescript
import { rokuDeploy } from 'roku-deploy';
rokuDeploy.stage({
    rootDir: "folder/with/your/source/code",
    stagingDir: 'path/to/staging/folder',
    files: [
        "source/**/*",
        "components/**/*",
        "images/**/*",
        "manifest"
    ],
    //...other options if necessary
}).then(function(){
    //the files have been copied to staging
}, function(error) {
    //it failed
    console.error(error);
});
```

### Creating a zip from an already-populated staging folder
Use this logic if you'd like to create a zip from your application folder.
```typescript
//create a signed package of your project
rokuDeploy.zip({
    outDir: 'folder/to/put/zip',
    stagingDir: 'path/to/files/to/zip',
    outFile: 'filename-of-your-app.zip'
    //...other options if necessary
}).then(function(){
    //the zip has been created
}, function(error) {
    //it failed
    console.error(error);
});
```

### Sideloading a project
If you've already created a zip using some other tool, you can use roku-deploy to sideload the zip.
```typescript
//sideload a package onto a specified Roku
rokuDeploy.sideload({
    host: 'ip-of-roku',
    password: 'password for roku dev admin portal',
    outDir: 'folder/where/your/zip/resides/',
    outFile: 'filename-of-your-app.zip'
    //...other options if necessary
}).then(function(){
    //the app has been sideloaded
}, function(error) {
    //it failed
    console.error(error);
});
```

Can't find what you need? Here are all of the public functions:
- stage
- zip
- sideload
- getFilPaths
- keyPress
- keyUp
- keyDown
- sendText
- closeChannel
- rekeyDevice
- createSignedPackage
- deleteDevChannel
- captureScreenshot
- getOptions
- checkRequiredOptions
- getDeviceInfo
- getDevId


### running roku-deploy as an npm script
From an npm script in `package.json`. (Requires `rokudeploy.json` to exist at the root level where this is being run)

    {
        "scripts": {
            "deploy": "roku-deploy"
        }
    }

## roku-deploy.json
As stated, many of the config settings are loaded from `roku-deploy.json`. Here is the loading order:
 - if CLI arguments are found, those are used.
 - if `roku-deploy.json` is found, fill in any missing settings.
 - Fill in any still missing settings with defaults specified in rokyeDeploy.getOptions().

Note that When roku-deploy is called from within a NodeJS script, the options passed into the roku-deploy methods will override any options found in `roku-deploy.json`.


## Files Array

The files array is how you specify what files are included in your project. Any strings found in the files array must be relative to `rootDir`, and are used as include _filters_, meaning that if a file matches the pattern, it is included.

For most standard projects, the default files array should work just fine:

```jsonc
{
    "files": [
        "source/**/*",
        "components/**/*",
        "images/**/*",
        "manifest"
    ]
}
```

This will copy all files from the standard roku folders directly into the package while maintaining each file's relative file path within `rootDir`.

If you want to include additonal files, you will need to provide the entire array. For example, if you have a folder with other assets, you could do the following:

```jsonc
{
    "files": [
        "source/**/*",
        "components/**/*",
        "images/**/*",
        "manifest"
        //your folder with other assets
        "assets/**/*",
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

 - if `src` is a glob pattern, then `dest` should be a path to the folder in the output directory. For example:
 `{ src: "lib/*.brs", dest: "source/lib"}`

 - if `src` is a glob pattern that includes `**`, then all files found in `src` after the `**` will retain their relative paths in `src` when copied to `dest`. For example:
 `{ src: "lib/**.brs", dest: "source/lib"}`

 - if `src` is a path to a folder, it will be ignored. If you want to copy a folder and its contents, use the glob syntax. The following example will copy all files from the `lib/vendor` folder recursively:
`{ src: "lib/vendor/**/*", dest: "vendor" }`

 - if `dest` is not specified, the root of the output folder is assumed

 ### Collision Handling
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



## roku-deploy Options
Here are the available options. The defaults are shown to the right of the option name, but all can be overridden:

- **host:** string (*required*)
    The IP address or hostname of the target Roku device. Example: `"192.168.1.21"`

- **password:** string (*required*)
    The password for logging in to the developer portal on the target Roku device

- **signingPassword:** string (*required for signing*)
    The password used for creating signed packages

- **rekeySignedPackage:** string (*required for rekeying*)
    Path to a copy of the signed package you want to use for rekeying

- **devId:** string
    Dev ID we are expecting the device to have. If supplied we check that the dev ID returned after keying matches what we expected


- **outDir?:** string = `"./out"`
    A full path to the folder where the zip/pkg package should be placed

- **outFile?:** string = `"roku-deploy"`
    The base filename the zip/pkg file should be given (excluding the extension)

- **rootDir?:** string = `'./'`
    The root path to the folder holding your project. The manifest file should be directly underneath this folder. Use this option when your roku project is in a subdirectory of where roku-deploy is installed.

- **files?:** ( string | { src: string; dest: string; } ) [] =
    ```
    [
        "source/**/*.*",
        "components/**/*.*",
        "images/**/*.*",
        "manifest"
    ]
    ```
    An array of file paths, globs, or `{ src: string; dest: string }` objects that will be copied into the deployment package. Make sure to _exclusively_ use forward slashes ( `/` ) for path separators (even on Windows), as backslashes are reserved for character escaping. You can learn more about this requirement [here](https://www.npmjs.com/package/fast-glob?activeTab=readme#how-to-write-patterns-on-windows).

    Using the {src;dest} objects will allow you to move files into different destination paths in the
    deployment package. This would be useful for copying environment-specific configs into a common config location
    (i.e. copy from `"ProjectRoot\configs\dev.config.json"` to `"roku-deploy.zip\config.json"`). Here's a sample:
    ```jsonc
    //deploy configs/dev.config.json as config.json
    {
        "src": "configs/dev.config.json",
        "dest": "config.json"
    }
    ```

    ```jsonc
    //you can omit the filename in dest if you want the file to keep its name. Just end dest with a trailing slash.
    {
        "src": "languages/english/language.xml",
        "dest": "languages/"
    }

    ```
    This will result in the `[sourceFolder]/configs/dev.config.json` file being copied to the zip file and named `"config.json"`.


    You can also provide negated globs (thanks to [glob-all](https://www.npmjs.com/package/glob-all)). So something like this would include all component files EXCEPT for specs.
    ```
    files: [
        'components/**/*.*',
        '!components/**/*.spec.*'
    ]
    ```

    *NOTE:* If you override this "files" property, you need to provide **all** config values, as your array will completely overwrite the default.

- **stagingDir?:** string = `` `${options.outDir}/.roku-deploy-staging` ``
   The path to the staging folder (where roku-deploy places all of the files right before zipping them up).

- **convertToSquashfs?:** boolean = `false`
   If true we convert to squashfs before creating the pkg file

- **incrementBuildNumber?:** boolean = `false`
    If true we increment the build number to be a timestamp in the format yymmddHHMM

- **username?:** string = `"rokudev"`
    The username for the roku box. This will always be 'rokudev', but allow to be passed in
    just in case roku adds support for custom usernames in the future

- **packagePort?:** string = 80
    The port used for package-related requests. This is mainly used for things like emulators, or when your roku is behind a firewall with a port-forward.

- **remotePort?:** string = 8060
    The port used for sending remote control commands (like home press or back press). This is mainly used for things like emulators, or when your roku is behind a firewall with a port-forward.

- **remoteDebug?:** boolean = false
     When publishing a side loaded channel this flag can be used to enable the socket based BrightScript debug protocol. This should always be `false` unless you're creating a plugin for an editor such as VSCode, Atom, Sublime, etc.
     More information on the BrightScript debug protocol can be found here: https://developer.roku.com/en-ca/docs/developer-program/debugging/socket-based-debugger.md

- **deleteInstalledChannel?:** boolean = true
    If true the previously installed dev channel will be deleted before installing the new one


Click [here](https://github.com/rokucommunity/roku-deploy/blob/8e1cbdfcccb38dad4a1361277bdaf5484f1c2bcd/src/RokuDeploy.ts#L897) to see the typescript interface for these options


## Troubleshooting
 - if you see a `ESOCKETTIMEDOUT` error during deployment, this can be caused by an antivirus blocking network traffic, so consider adding a special exclusion for your Roku device.

## Changelog
Click [here](CHANGELOG.md) to view the changelog
