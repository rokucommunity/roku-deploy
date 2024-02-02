import { RokuDeploy } from './RokuDeploy';

//export everything from the RokuDeploy file
export * from './RokuDeploy';
export * from './util';
export * from './RokuDeployOptions';
export * from './Errors';
export * from './DeviceInfo';

//create a new static instance of RokuDeploy, and export those functions for backwards compatibility
export const rokuDeploy = new RokuDeploy();

let createPackage = RokuDeploy.prototype.createPackage.bind(rokuDeploy);
let deleteInstalledChannel = RokuDeploy.prototype.deleteDevChannel.bind(rokuDeploy);
let deploy = RokuDeploy.prototype.deploy.bind(rokuDeploy);
let deployAndSignPackage = RokuDeploy.prototype.deployAndSignPackage.bind(rokuDeploy);
let getDestPath = RokuDeploy.prototype.getDestPath.bind(rokuDeploy);
let getDeviceInfo = RokuDeploy.prototype.getDeviceInfo.bind(rokuDeploy);
let getFilePaths = RokuDeploy.prototype.getFilePaths.bind(rokuDeploy);
let getOptions = RokuDeploy.prototype.getOptions.bind(rokuDeploy);
let getOutputPkgFilePath = RokuDeploy.prototype.getOutputPkgFilePath.bind(rokuDeploy);
let getOutputZipFilePath = RokuDeploy.prototype.getOutputZipFilePath.bind(rokuDeploy);
let normalizeFilesArray = RokuDeploy.prototype.normalizeFilesArray.bind(rokuDeploy);
let normalizeRootDir = RokuDeploy.prototype.normalizeRootDir.bind(rokuDeploy);
let parseManifest = RokuDeploy.prototype.parseManifest.bind(rokuDeploy);
let prepublishToStaging = RokuDeploy.prototype.stage.bind(rokuDeploy);
let pressHomeButton = RokuDeploy.prototype.pressHomeButton.bind(rokuDeploy);
let publish = RokuDeploy.prototype.sideload.bind(rokuDeploy);
let rekeyDevice = RokuDeploy.prototype.rekeyDevice.bind(rokuDeploy);
let retrieveSignedPackage = RokuDeploy.prototype.retrieveSignedPackage.bind(rokuDeploy);
let signExistingPackage = RokuDeploy.prototype.signPackage.bind(rokuDeploy);
let stringifyManifest = RokuDeploy.prototype.stringifyManifest.bind(rokuDeploy);
let takeScreenshot = RokuDeploy.prototype.captureScreenshot.bind(rokuDeploy);
let getDevId = RokuDeploy.prototype.getDevId.bind(rokuDeploy);
let zipFolder = RokuDeploy.prototype.zipFolder.bind(rokuDeploy);
let zipPackage = RokuDeploy.prototype.zip.bind(rokuDeploy);

export {
    createPackage,
    deleteInstalledChannel,
    deploy,
    deployAndSignPackage,
    getDestPath,
    getDeviceInfo,
    getFilePaths,
    getOptions,
    getOutputPkgFilePath,
    getOutputZipFilePath,
    normalizeFilesArray,
    normalizeRootDir,
    parseManifest,
    prepublishToStaging,
    pressHomeButton,
    publish,
    rekeyDevice,
    retrieveSignedPackage,
    signExistingPackage,
    stringifyManifest,
    takeScreenshot,
    getDevId,
    zipFolder,
    zipPackage
};
