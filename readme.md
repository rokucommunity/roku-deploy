# roku-deploy

Publish Roku projects to a Roku device by using Node.js.


[![Build Status](https://travis-ci.org/RokuCommunity/roku-deploy.svg?branch=master)](https://travis-ci.org/RokuCommunity/roku-deploy)
[![Coverage Status](https://coveralls.io/repos/github/rokucommunity/roku-deploy/badge.svg?branch=master)](https://coveralls.io/github/rokucommunity/roku-deploy?branch=master)
[![NPM Version](https://badge.fury.io/js/roku-deploy.svg?style=flat)](https://npmjs.org/package/roku-deploy)
## Installation

    npm install roku-deploy

## Requirements

1. Your project must be structured the way that Roku expects. The source files can be in a subdirectory (using the `rootDir` config option), but whever your roku files exist, they must align with the following folder structure:  

    components/  
    images/  
    source/  
    manifest

2. You should create a rokudeploy.json file at the root of your project that contains all of the overrides to the default options. roku-deploy will auto-detect this file and use it when possible.

sample rokudeploy.json

```json
{
    "host": "192.168.1.101",
    "password": "securePassword"
}
```
## Usage

From a node script
```javascript
var rokuDeploy = require('roku-deploy');

//deploy a .zip package of your project to a roku device
rokuDeploy.deploy({
    host: 'ip-of-roku',
    password: 'password for roku dev admin portal'
    //other options if necessary
}).then(function(){
    //it worked
}, function(error) {
    //it failed
    console.error(error);
});
```
Or 
```javascript
//create a signed package of your project
rokuDeploy.deployAndSignPackage({
    host: 'ip-of-roku',
    password: 'password for roku dev admin portal',
    signingPassword: 'signing password'
    //other options if necessary
}).then(function(pathToSignedPackage){
    console.log('Signed package created at ', pathToSignedPackage);
}, function(error) {
    //it failed
    console.error(error);
});
```

From an npm script in `package.json`. (Requires `rokudeploy.json` to exist at the root level where this is being run)

    {
        "scripts": {
            "deploy": "roku-deploy"
        }
    }

You can provide a callback in any of the higher level methods, which allows you to modify the copied contents before the package is zipped. An info object is passed in with the following attributes
- **manifestData:** [key: string]: string
    Contains all the parsed values from the manifest file
- **stagingFolderPath:** string
    Path to staging folder to make it so you only need to know the relative path to what you're trying to modify

        let options = {
            host: 'ip-of-roku',
            password: 'password for roku dev admin portal'
            //other options if necessary
        };

        rokuDeploy.deploy(options, (info) => {
            //modify staging dir before it's zipped
	    }).then(function(){
            //it worked
        }, function(){
            //it failed
        });

## Options
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
    An array of file paths, globs, or {src:string;dest:string} objects that will be copied into the deployment package.
        
    Using the {src;dest} objects will allow you to move files into different destination paths in the
    deployment package. This would be useful for copying environment-specific configs into a common config location 
    (i.e. copy from `"ProjectRoot\configs\dev.config.json"` to `"roku-deploy.zip\config.json"`). Here's a sample:  
    ```json
    //deploy configs/dev.config.json as config.json
    {
        "src": "configs/dev.config.json",
        "dest": "config.json"
    }
    ```

    ```json
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
    
- **retainStagingFolder?:** boolean = `false`  
    Set this to true to prevent the staging folder from being deleted after creating the package. This is helpful for troubleshooting why your package isn't being created the way you expected.

- **convertToSquashfs?:** boolean = `false`  
   If true we convert to squashfs before creating the pkg file

- **incrementBuildNumber?:** boolean = `false`  
    If true we increment the build number to be a timestamp in the format yymmddHHMM

- **username?:** string = `"rokudev"`  
    The username for the roku box. This will always be 'rokudev', but allow to be passed in
    just in case roku adds support for custom usernames in the future

Click [here](https://github.com/rokucommunity/roku-deploy/blob/6ecc8642c77b9df59bf087f3d74d31275fc9e11a/src/RokuDeploy.ts#L870) to see the typescript interface for these options

## Changelog
Click [here](CHANGELOG.md) to view the changelog
