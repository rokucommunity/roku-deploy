#!/usr/bin/env node
import { deploy, getOptions, RokuDeployOptions } from './index';
import * as fsExtra from 'fs-extra';

let options: RokuDeployOptions;
//load a brsdeploy.json file if it exists
if (fsExtra.existsSync('brsdeploy.json')) {
    let configFileText = fsExtra.readFileSync('brsdeploy.json').toString();
    let optionsFromFile = JSON.parse(configFileText);
    options = getOptions(optionsFromFile);
} else {
    options = getOptions();
}

deploy(options);