# roku-deploy

Publish Roku projects to a Roku device by using Node.js.


[![Build Status](https://travis-ci.org/TwitchBronBron/roku-deploy.svg?branch=master)](https://travis-ci.org/TwitchBronBron/roku-deploy)
[![Coverage Status](https://coveralls.io/repos/github/TwitchBronBron/roku-deploy/badge.svg?branch=master)](https://coveralls.io/github/TwitchBronBron/roku-deploy?branch=master)
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

rokuDeploy.deploy({
    host: 'ip-of-roku',
    password: 'password for roku dev admin portal'
    //other options if necessary
}).then(function(){
    //it worked
}, function(){
    //it failed
});
```

From an npm script in package.json. (Requires rokudeploy.json to exist at the root level where this is being run)

    {
        "scripts": {
            "deploy": "roku-deploy"
        }
    }

## Options
Here are the available options. The defaults are shown to the right of the option name, but all can be overridden:

- **host:** string (*required*)  
    The IP address or hostname of the target Roku device. Example: `"192.168.1.21"`

- **password:** string (*required*)  
    The password for logging in to the developer portal on the target Roku device

- **outDir?:** string = `"./out"`  
    A full path to the folder where the zip package should be placed  

- **outFile?:** string = `"roku-deploy.zip"`  
    The name the zip file should be given.  

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
    ```
    {
         "src": "configs/dev.config.json",
         "dest": "config.json"
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
    Set this to true prevent the staging folder from being deleted after creating the package. This is helpful for troubleshooting why your package isn't being created the way you expected.

- **username?:** string = `"rokudev"`  
    The username for the roku box. This will always be 'rokudev', but allow to be passed in
    just in case roku adds support for custom usernames in the future
   

Click [here](https://github.com/TwitchBronBron/roku-deploy/blob/2648069de1f3e889c58b8119b5f852f126e60042/src/index.ts#L288) to see the typescript interface for these options

