import { RokuDeploy } from './RokuDeploy';

//export everything from the RokuDeploy file
export * from './RokuDeploy';

//create a new static instance of RokuDeploy, and export those functions for backwards compatibility
let rokuDeploy = new RokuDeploy();

let createPackage = RokuDeploy.prototype.createPackage.bind(rokuDeploy);
let prepublishToStaging = RokuDeploy.prototype.prepublishToStaging.bind(rokuDeploy);
let zipPackage = RokuDeploy.prototype.zipPackage.bind(rokuDeploy);
let getOutputZipFilePath = RokuDeploy.prototype.getOutputZipFilePath.bind(rokuDeploy);
let pressHomeButton = RokuDeploy.prototype.pressHomeButton.bind(rokuDeploy);
let publish = RokuDeploy.prototype.publish.bind(rokuDeploy);
let getStagingFolderPath = RokuDeploy.prototype.getStagingFolderPath.bind(rokuDeploy);
let signExistingPackage = RokuDeploy.prototype.signExistingPackage.bind(rokuDeploy);
let makeFilesAbsolute = RokuDeploy.prototype.makeFilesAbsolute.bind(rokuDeploy);
let normalizeFilesOption = RokuDeploy.prototype.normalizeFilesOption.bind(rokuDeploy);
let deploy = RokuDeploy.prototype.deploy.bind(rokuDeploy);
let zipFolder = RokuDeploy.prototype.zipFolder.bind(rokuDeploy);
let parseManifest = RokuDeploy.prototype.parseManifest.bind(rokuDeploy);
let endsWithSlash = RokuDeploy.prototype.endsWithSlash.bind(rokuDeploy);
let getFilePaths = RokuDeploy.prototype.getFilePaths.bind(rokuDeploy);
let normalizeRootDir = RokuDeploy.prototype.normalizeRootDir.bind(rokuDeploy);
let getOptions = RokuDeploy.prototype.getOptions.bind(rokuDeploy);
let getOutputPkgFilePath = RokuDeploy.prototype.getOutputPkgFilePath.bind(rokuDeploy);

let __request = RokuDeploy.request;

export {
    __request,
    createPackage,
    deploy,
    endsWithSlash,
    getFilePaths,
    getOptions,
    getOutputZipFilePath,
    getStagingFolderPath,
    makeFilesAbsolute,
    normalizeFilesOption,
    normalizeRootDir,
    parseManifest,
    prepublishToStaging,
    pressHomeButton,
    publish,
    signExistingPackage,
    zipFolder,
    zipPackage,
    getOutputPkgFilePath
};