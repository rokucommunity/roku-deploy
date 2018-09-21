# roku-deploy

Publish Roku projects to a Roku device by using Node.js.


[![Build Status](https://travis-ci.org/TwitchBronBron/roku-deploy.svg?branch=master)](https://travis-ci.org/TwitchBronBron/roku-deploy)
[![Coverage Status](https://coveralls.io/repos/github/TwitchBronBron/roku-deploy/badge.svg?branch=master)](https://coveralls.io/github/TwitchBronBron/roku-deploy?branch=master)
 [![NPM Version](https://badge.fury.io/js/roku-deploy.svg?style=flat)](https://npmjs.org/package/roku-deploy)
## Installation

    npm install roku-deploy

## Requirements

 1. Your project must be structured the way that Roku expects. This means the following folder structure:  
     
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

rokuDeploy({
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
```TypeScript
export interface RokuDeployOptions {
    /**
     * A full path to the folder where the zip package should be placed
     * @default "./out"
     */
    outDir?: string;
    /**
     * The name the zip file should be given. 
     * @default "roku-deploy.zip"
     */
    outFile?: string;
    /**
     * The root path to the folder holding your project. This folder should include the manifest file.
     * @default './'
     */
    rootDir?: string;
    /**
     * An array of file paths, file globs, or {src:string;dest:string} objects that will be copied into the deployment package.
     * 
     * This can also include {src;dest} objects which allows you to move files into different destination paths in the
     * deployment package. This would be useful for copying environment-specific configs into a common config location 
     * (i.e. copy from "ProjectRoot\configs\dev.config.json" to "roku-deploy.zip\config.json"). Here's a sample:
     * 
     * files: [
     *  "manifest",
     *  "source/**/*.*",
     *  {
     *      "src": "configs/app.dev.config",
     *      "dest": "app.config"
     *  },
     *  {
     *      "src": "images/english/**/*.*",
     *      //you must add a trailing slash for directories
     *      "dest": "images/"
     *  }
     * ]
     * 
     * If you specify "files", you need to provide ALL config values, as your array will completely overwrite the default.
     * 
     *
     * @default [
            "source/**/*.*",
            "components/**/*.*",
            "images/**/*.*",
            "manifest"
        ]
     */
    files?: string[] | { src: string; dest: string; };
    /**
     * Set this to true prevent the staging folder from being deleted after creating the package
     * @default false
     */
    retainStagingFolder?: boolean;
    /**
     * The IP address or hostname of the target Roku device. 
     * @required
     * @example "192.168.1.21" 
     * 
     */
    host?: string;
    /**
     * The username for the roku box. This will always be 'rokudev', but allow to be passed in
     * just in case roku adds support for custom usernames in the future
     * @default "rokudev"
     */
    username?: string;
    /**
     * The password for logging in to the developer portal on the target Roku device
     * @required
     */
    password?: string;
}
```
