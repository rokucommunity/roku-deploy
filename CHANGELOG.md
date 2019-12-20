# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [2.6.1] - 2019-12-20
### Fixed
 - Throw better error message during publish when missing the zip file.



## [2.6.0] - 2019-12-04
### Added
 - `remotePort` and `packagePort` for customizing the ports used for network-related roku requests. Mainly useful for emulators or communicating with Rokus behind port-forwards.



## [2.6.0-beta.0] - 2019-11-18
### Added
 - `remotePort` and `packagePort` for customizing the ports used for network-related roku requests. Mainly useful for emulators or communicating with Rokus behind port-forwards. 



## [2.5.0] - 2019-10-05
### Added
 - `stagingFolderPath` option to allow overriding the location of the staging folder



## [2.4.1] - 2019-08-27
### Changed
 - updated new repository location (https://github.com/RokuCommunity/roku-deploy)



## [2.4.0] - 2019-08-26
### Added
 - `deleteInstalledChannel` method that will delete the installed channel on the remote Roku

### Changed
 - `deploy` now deletes any installed channel before publishing the new channel



## [2.3.0] - 2019-08-20
### Added
 - support for returning a promise in the `createPackage` `beforeZipCallback` parameter.



## [2.2.1] - 2019-08-07
### Fixed
 - colors starting with # symbol in manifest file that were being treated as comments. This removes the dependency on `ini` in favor of a local function.



## [2.2.0] - 2019-07-05
### Added
 - support for converting to squashfs
### Fixed
 - issue where manifest files with `bs_const` weren't being handled correctly



## [2.1.0] - 2019-05-14
### Added
 - rekeying capability



## [2.1.0-beta1] - 2019-02-15
### Added
 - Support for signed package creation
 - ability to register a callback function before the package is zipped. 
 - `incrementBuildNumber` option
### Changed
 - Stop calling home button on deploy
 - `outFile` to be `baseName` so it can be used for both zip and pkg file names



## [2.0.0] - 2019-01-07
### Added
 - support for absolute file paths in the `files` property
 - dereference symlinks on file copy



## [2.0.0-beta5] - 2019-01-18
### Changed
 - Changed `normalizeFilesOption` to be sync instead of async, since it didn't need to be async.



## [2.0.0-beta4] - 2019-01-17
### Fixed
 - bug that wasn't using rootDir for glob matching



## [2.0.0-beta3] - 2019-01-17
### Changed
 - export the `getFilepaths` for use in external libraries



## [2.0.0-beta2] - 2019-01-15
### Changed
 - prevent empty directories from being created
### Fixed
 - bug in `src`/`dest` globs.
 - bug that wasn't copying folders properly



## [2.0.0-beta1] - 2019-01-07
### Changed
 - removed the requirement for manifest to be located at the top of `rootDir`. Instead, it is simply assumed to exist.
### Fixed
 - regression issue that prevented folder names from being used without globs



## [1.0.0] - 2018-12-18
### Added
 - support for negated globs


[2.6.1]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.6.0...v2.6.1
[2.6.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.5.0...v2.6.0
[2.6.0-beta.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.5.0...v2.6.0-beta.0
[2.5.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.4.1...v2.5.0
[2.4.1]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.4.0...v2.4.1
[2.4.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.3.0...v2.4.0
[2.3.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.2.1...v2.3.0
[2.2.1]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.2.0...v2.2.1
[2.2.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.1.0...v2.2.0
[2.1.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.1.0-beta1...v2.1.0
[2.1.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.1.0-beta1...v2.1.0
[2.0.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta5...v2.0.0
[2.0.0-beta5]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta4...v2.0.0-beta5
[2.0.0-beta4]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta3...v2.0.0-beta4
[2.0.0-beta3]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta2...v2.0.0-beta3
[2.0.0-beta2]:  https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta1...v2.0.0-beta2
[2.0.0-beta1]:  https://github.com/RokuCommunity/roku-deploy/compare/v1.0.0...v2.0.0-beta1
[1.0.0]:  https://github.com/RokuCommunity/roku-deploy/compare/v0.2.1...v1.0.0