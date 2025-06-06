# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [3.12.6](https://github.com/rokucommunity/roku-deploy/compare/3.12.5...v3.12.6) - 2025-06-03
### Changed
 - chore: upgrade to the `undent` package instead of `dedent` ([#192](https://github.com/rokucommunity/roku-deploy/pull/196))



## [3.12.5](https://github.com/rokucommunity/roku-deploy/compare/3.12.4...v3.12.5) - 2025-05-05
### Changed
 - (chore) Add missing template workflows for shared ci ([#189](https://github.com/rokucommunity/roku-deploy/pull/189))
 - (chore) Shared CI Support Prerelease ([#185](https://github.com/rokucommunity/roku-deploy/pull/185))



## [3.12.4](https://github.com/rokucommunity/roku-deploy/compare/v3.12.3...v3.12.4) - 2025-01-22
### Fixed
 - fixed an issue with `577` error codes ([#182](https://github.com/rokucommunity/roku-deploy/pull/182))



## [3.12.3](https://github.com/rokucommunity/roku-deploy/compare/v3.12.2...v3.12.3) - 2024-12-06
### Changed
 - Identify when a 577 error is thrown, send a new developer friendly message ([#180](https://github.com/rokucommunity/roku-deploy/pull/180))
### Fixed
 - issues with detecting "check for updates required" ([#181](https://github.com/rokucommunity/roku-deploy/pull/181))



## [3.12.2](https://github.com/rokucommunity/roku-deploy/compare/v3.12.1...v3.12.2) - 2024-10-18
### Fixed
 - updated regex to find a signed package on `/plugin_package` page ([#176](https://github.com/rokucommunity/roku-deploy/pull/176))



## [3.12.1](https://github.com/rokucommunity/roku-deploy/compare/v3.12.0...v3.12.1) - 2024-07-19
### Changed
 - fix-node14 CI/CD issues ([#165](https://github.com/rokucommunity/roku-deploy/pull/165))
### Fixed
 - bug with absolute paths and `getDestPath` ([#171](https://github.com/rokucommunity/roku-deploy/pull/171))



## [3.12.0](https://github.com/rokucommunity/roku-deploy/compare/v3.11.3...v3.12.0) - 2024-03-01
### Changed
 - Support overriding various package upload form data ([#136](https://github.com/rokucommunity/roku-deploy/pull/136))



## [3.11.3](https://github.com/rokucommunity/roku-deploy/compare/v3.11.2...v3.11.3) - 2024-02-29
### Fixed
 - Retry the convertToSquahsfs request to mitigate the HPE_INVALID_CONSTANT error ([#145](https://github.com/rokucommunity/roku-deploy/pull/145))



## [3.11.2](https://github.com/rokucommunity/roku-deploy/compare/v3.11.1...v3.11.2) - 2023-12-20
### Changed
 - Update wrong host password error message ([#134](https://github.com/rokucommunity/roku-deploy/pull/134))



## [3.11.1](https://github.com/rokucommunity/roku-deploy/compare/v3.11.0...v3.11.1) - 2023-11-30
### Fixed
 - Wait for file stream to close before resolving promise ([#133](https://github.com/rokucommunity/roku-deploy/pull/133))



## [3.11.0](https://github.com/rokucommunity/roku-deploy/compare/v3.10.5...v3.11.0) - 2023-11-28
### Changed
 - Add public function `normalizeDeviceInfoFieldValue` to normalize device-info field values ([#129](https://github.com/rokucommunity/roku-deploy/pull/129))



## [3.10.5](https://github.com/rokucommunity/roku-deploy/compare/v3.10.4...v3.10.5) - 2023-11-14
### Changed
 - better device-info docs ([#128](https://github.com/rokucommunity/roku-deploy/pull/128))
 - Better deploy error detection ([#127](https://github.com/rokucommunity/roku-deploy/pull/127))



## [3.10.4](https://github.com/rokucommunity/roku-deploy/compare/v3.10.3...v3.10.4) - 2023-11-03
### Changed
 - Enhance getDeviceInfo() method to support camelCase and convert bool|number strings to their primitive types ([#120](https://github.com/rokucommunity/roku-deploy/pull/120))



## [3.10.3](https://github.com/rokucommunity/roku-deploy/compare/v3.10.2...3.10.3) - 2023-07-22
### Changed
 - Bump word-wrap from 1.2.3 to 1.2.4 ([#117](https://github.com/rokucommunity/roku-deploy/pull/117))



## [3.10.2](https://github.com/rokucommunity/roku-deploy/compare/v3.10.1...3.10.2) - 2023-05-10
### Changed
 - remove `request` in favor of `postman-request` to fix security issues
 - remove dev dependency `coveralls` in favor of `coveralls-next` to fix security issues
### Fixed
 - compatibility issues with Node.js v19 and above ([#115](https://github.com/rokucommunity/roku-deploy/pull/115))
 - npm audit issues ([#116](https://github.com/rokucommunity/roku-deploy/pull/116))



## [3.10.1](https://github.com/rokucommunity/roku-deploy/compare/v3.10.0...v3.10.1) - 2023-04-14
### Changed
 - Bump xml2js from 0.4.23 to 0.5.0 ([#112](https://github.com/rokucommunity/roku-deploy/pull/112))
 - Fix build status badge ([ad2c9ec](https://github.com/rokucommunity/roku-deploy/commit/ad2c9ec))



## [3.10.0](https://github.com/rokucommunity/roku-deploy/compare/v3.9.3...v3.10.0) - 2023-03-16
### Changed
 - Use micromatch instead of picomatch ([#109](https://github.com/rokucommunity/roku-deploy/pull/109))



## [3.9.3](https://github.com/rokucommunity/roku-deploy/compare/v3.9.2...3.9.3) - 2023-01-12
### Changed
 - Bump minimatch from 3.0.4 to 3.1.2 ([#107](https://github.com/rokucommunity/roku-deploy/pull/107))
 - Bump json5 from 2.2.0 to 2.2.3 ([#106](https://github.com/rokucommunity/roku-deploy/pull/106))



## [3.9.2](https://github.com/rokucommunity/roku-deploy/compare/v3.9.1...3.9.2) - 2022-10-03
### Fixed
 - Replace minimatch with picomatch ([#101](https://github.com/rokucommunity/roku-deploy/pull/101))



## [3.9.1](https://github.com/rokucommunity/roku-deploy/compare/v3.9.0...3.9.1) - 2022-09-19
### Fixed
 - Sync retainStagingFolder, stagingFolderPath with options, fixing a critical backwards compatibility bug ([#100](https://github.com/rokucommunity/roku-deploy/pull/100))



## [3.9.0](https://github.com/rokucommunity/roku-deploy/compare/v3.8.1...3.9.0) - 2022-09-16
### Added
 - Add `stagingDir` and `retainStagingDir`. ([#99](https://github.com/rokucommunity/roku-deploy/pull/99))
### Changed
 - deprecated `stagingFolderPath` and `retainStagingFolder. ([#99](https://github.com/rokucommunity/roku-deploy/pull/99))



## [3.8.1](https://github.com/rokucommunity/roku-deploy/compare/v3.8.0...3.8.1) - 2022-09-02
### Changed
 - Bump moment from 2.29.2 to 2.29.4 ([#98](https://github.com/rokucommunity/roku-deploy/pull/98))



## [3.8.0](https://github.com/rokucommunity/roku-deploy/compare/v3.7.1...3.8.0) - 2022-08-30
### Added
 - add support for `remotedebug_connect_early` form field ([#97](https://github.com/rokucommunity/roku-deploy/pull/97))
 - Better compile error handling ([#96](https://github.com/rokucommunity/roku-deploy/pull/96))



## [3.7.1](https://github.com/RokuCommunity/roku-deploy/compare/v3.7.0...v3.7.1) - 2022-06-08
### Fixed
 - make the json parser less sensitive to trailing commas ([#95](https://github.com/rokucommunity/roku-deploy/pull/95))



## [3.7.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.6.0...v3.7.0) - 2022-05-23
### Added
 - new `files` parameter to `zipFolder()` to allow including/excluding files when building the zip
 - new `rokuDeploy.takeScreenshot()` function ([#92](https://github.com/rokucommunity/roku-deploy/pull/92))
 - export `rokuDeploy` const to improve the docs. Developers should switch to `import { rokuDeploy } from 'roku-deploy'` instead of `import * as rokuDeploy from 'roku-deploy'`.



## [3.6.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.5.4...v3.6.0) - 2022-04-13
### Added
 - `deleteInstalledChannel` option to specify whether the previously installed dev channel will be deleted before installing the new one



## [3.5.4](https://github.com/RokuCommunity/roku-deploy/compare/v3.5.3...v3.5.4) - 2022-03-17
### Changed
 - use `fast-glob` instead of `glob` for globbing. ([#86](https://github.com/rokucommunity/roku-deploy/pull/86))
### Fixed
 - significant performance issues during globbing. ([#86](https://github.com/rokucommunity/roku-deploy/pull/86))



## [3.5.3](https://github.com/RokuCommunity/roku-deploy/compare/v3.5.2...v3.5.3) - 2022-02-16
### Fixed
 - removed `request` property from `RokuDeploy` class that was only there for unit testing, and was causing typescript issues in downstream dependencies. ([#84](https://github.com/rokucommunity/roku-deploy/pull/84))



## [3.5.2](https://github.com/RokuCommunity/roku-deploy/compare/v3.5.1...v3.5.2) - 2021-11-02
### Fixed
 - bug introduced in v3.5.0 with `retrieveSignedPackage` that would produce an empty package. ([#82](https://github.com/rokucommunity/roku-deploy/pull/82))



## [3.5.1](https://github.com/RokuCommunity/roku-deploy/compare/v3.5.0...v3.5.1) - 2021-11-02
### Fixed
 - bug introduced in v3.5.0 with `rekeyDevice` that would crash because the read stream was closed before the request got sent. ([#81](https://github.com/rokucommunity/roku-deploy/pull/81))



## [3.5.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.4.2...v3.5.0) - 2021-10-27
### Added
 - ability to use negated non-rootDir top-level patterns in the `files` array ([#78](https://github.com/rokucommunity/roku-deploy/pull/78))



## [3.4.2](https://github.com/RokuCommunity/roku-deploy/compare/v3.4.1...v3.4.2) - 2021-09-17
### Fixed
 - Prevent deploy crashes when target Roku doesn't have an installed channel ([#65](https://github.com/rokucommunity/roku-deploy/pull/65))
 - reduce npm package size by ignoring .tgz files during publishing (#d6d7c57)(https://github.com/rokucommunity/roku-deploy/commit/d6d7c5743383363d7e8db13c60b03d1df5d5563b)



## [3.4.1](https://github.com/RokuCommunity/roku-deploy/compare/v3.4.0...v3.4.1) - 2021-06-01
### Fixed
 - incorrect path separator issue on windows.
 - missing `chalk` prod dependency causing import issues



## [3.4.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.3.0...v3.4.0) - 2021-05-28
### Added
 - `preFileZipCallback` parameter to `RokuDeploy.zipFolder` to allow per-file modifications before adding the file to the zip
### Changed
 - switch internal zip library to [jszip](https://www.npmjs.com/package/jszip) which seems to yield 75% faster zip times.



## [3.3.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.2.4...v3.3.0) - 2021-02-05
### Added
 - support for `timeout` option to fail deploys after a certain amount of time



## [3.2.4](https://github.com/RokuCommunity/roku-deploy/compare/v3.2.3...v3.2.4) - 2021-01-08
### Fixed
 - don't fail deployment when home press command returns 202 http status code



## [3.2.3](https://github.com/RokuCommunity/roku-deploy/compare/v3.2.2...v3.2.3) - 2020-08-14
### Changed
 - throw exception during `copyToStaging` when rootDir does not exist
 - throw exception during `zipPackage` when `${stagingFolder}/manifest` does not exist


## [3.2.2](https://github.com/RokuCommunity/roku-deploy/compare/v3.2.1...v3.2.2) - 2020-07-14
### Fixed
 - bug when loading `stagingFolderPath` from `rokudeploy.json` or `bsconfig.json` that would cause an exception.



## [3.2.1](https://github.com/RokuCommunity/roku-deploy/compare/v3.2.0...v3.2.1) - 2020-07-07
### Changed
 - `rokudeploy.json` now supports jsonc (json with comments)
### Fixed
 - loading `bsconfig.json` file with comments would fail the entire roku-deploy process.



## [3.2.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.1.1...v3.2.0) - 2020-07-06
### Added
 - support for loading `bsconfig.json` files.



## [3.1.1](https://github.com/RokuCommunity/roku-deploy/compare/v3.1.0...v3.1.1) - 2020-05-08
### Added
 - export `DefaultFilesArray` so other tools can use that as their defaults as well.



## [3.1.0](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.2...v3.1.0) - 2020-05-08
### Added
 - config setting `retainDeploymentArchive` which specifies if the zip should be deleted after a publish.



## [3.0.2](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.1...v3.0.2) - 2020-04-10
### Fixed
 - issue where `prepublishToStaging` wasn't recognizing nested files inside a symlinked folder.



## [3.0.1](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0...v3.0.1) - 2020-04-03
### Changed
 - coerce `rootDir` to an absolute path in `rokuDeploy.getDestPath` and `rokuDeploy.getFilePaths`.



## [3.0.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.7.0...v3.0.0) - 2020-03-23
### Added
 - all changes from v3.0.0-beta1-v3.0.0-beta.8



## [3.0.0-beta.8](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.7...v3.0.0-beta.8) - 2020-03-06
### Added
 - all changes from 2.7.0



## [2.7.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.6.1...v2.7.0) - 2020-03-06
### Added
 - support for `remoteDebug` property which enables the experimental remote debug protocol on newer versions of Roku hardware. See [this](https://developer.roku.com/en-ca/docs/developer-program/debugging/socket-based-debugger.md) for more information.


## [3.0.0-beta.7](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.6...v3.0.0-beta.7) - 2020-01-10
### Fixed
 - bug during file copy that was not prepending `stagingFolderPath` to certain file operations.



## [3.0.0-beta.6](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.5...v3.0.0-beta.6) - 2020-01-06
### Fixed
 - bug that was not discarding duplicate file entries targeting the same `dest` path.



## [3.0.0-beta.5](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.4...v3.0.0-beta.5) - 2019-12-20
### Added
 - all changes from 2.6.1



## [3.0.0-beta.4](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.3...v3.0.0-beta.4) - 2019-11-12
### Added
 - all changes from 2.6.0



## [3.0.0-beta.3](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.2...v3.0.0-beta.3)  - 2019-11-12
### Added
 - `RokuDeploy.getDestPath` function which returns the dest path for a full file path. Useful for figuring out where a file will be placed in the pkg.
### Changed
 - made `RokuDeploy.normalizeFilesArray` public
 - disallow using explicit folder paths in files array. You must use globs for folders.



## [3.0.0-beta.2](https://github.com/RokuCommunity/roku-deploy/compare/v3.0.0-beta.1...v3.0.0-beta.2) - 2019-10-23
### Changed
 - signature of `getFilePaths()` to no longer accept `stagingFolderPath`
 - `getFilePaths()` now returns `dest` file paths relative to pkg instead of absolute file paths. These paths do _not_ include a leading slash



## [3.0.0-beta.1](https://github.com/RokuCommunity/roku-deploy/compare/v2.5.0...v3.0.0-beta.1) - 2019-10-16
### Added
 - information in the readme about the `files` array
 - support for file overrides in the `files` array. This supports including the same file from A and B, and letting the final file override previous files.
### Changed
 - the files array is now a bit more strict, and has a more consistent approach.
## [2.6.1] - 2019-12-20
### Fixed
 - Throw better error message during publish when missing the zip file.



## [2.6.0](https://github.com/RokuCommunity/roku-deploy/compare/2.6.0-beta.0...v2.6.0) - 2019-12-04
### Added
 - `remotePort` and `packagePort` for customizing the ports used for network-related roku requests. Mainly useful for emulators or communicating with Rokus behind port-forwards.



## [2.6.0-beta.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.5.0...v2.6.0-beta.0) - 2019-11-18
### Added
 - `remotePort` and `packagePort` for customizing the ports used for network-related roku requests. Mainly useful for emulators or communicating with Rokus behind port-forwards.



## [2.5.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.4.1...v2.5.0) - 2019-10-05
### Added
 - `stagingFolderPath` option to allow overriding the location of the staging folder



## [2.4.1](https://github.com/RokuCommunity/roku-deploy/compare/v2.4.0...v2.4.1) - 2019-08-27
### Changed
 - updated new repository location (https://github.com/RokuCommunity/roku-deploy)



## [2.4.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.3.0...v2.4.0) - 2019-08-26
### Added
 - `deleteInstalledChannel` method that will delete the installed channel on the remote Roku
### Changed
 - `deploy` now deletes any installed channel before publishing the new channel



## [2.3.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.2.1...v2.3.0) - 2019-08-20
### Added
 - support for returning a promise in the `createPackage` `beforeZipCallback` parameter.



## [2.2.1](https://github.com/RokuCommunity/roku-deploy/compare/v2.2.0...v2.2.1) - 2019-08-07
### Fixed
 - colors starting with # symbol in manifest file that were being treated as comments. This removes the dependency on `ini` in favor of a local function.



## [2.2.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.1.0...v2.2.0) - 2019-07-05
### Added
 - support for converting to squashfs
### Fixed
 - issue where manifest files with `bs_const` weren't being handled correctly



## [2.1.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.1.0-beta1...v2.1.0) - 2019-05-14
### Added
 - rekeying capability



## [2.1.0-beta1](https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0...v2.1.0-beta1) - 2019-02-15
### Added
 - Support for signed package creation
 - ability to register a callback function before the package is zipped.
 - `incrementBuildNumber` option
### Changed
 - Stop calling home button on deploy
 - `outFile` to be `baseName` so it can be used for both zip and pkg file names



## [2.0.0](https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta5...v2.0.0) - 2019-01-07
### Added
 - support for absolute file paths in the `files` property
 - dereference symlinks on file copy



## [2.0.0-beta5](https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta4...v2.0.0-beta5) - 2019-01-18
### Changed
 - Changed `normalizeFilesOption` to be sync instead of async, since it didn't need to be async.



## [2.0.0-beta4](https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta3...v2.0.0-beta4) - 2019-01-17
### Fixed
 - bug that wasn't using rootDir for glob matching



## [2.0.0-beta3](https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta2...v2.0.0-beta3) - 2019-01-17
### Changed
 - export the `getFilepaths` for use in external libraries



## [2.0.0-beta2](https://github.com/RokuCommunity/roku-deploy/compare/v2.0.0-beta1...v2.0.0-beta2) - 2019-01-15
### Changed
 - prevent empty directories from being created
### Fixed
 - bug in `src`/`dest` globs.
 - bug that wasn't copying folders properly



## [2.0.0-beta1](https://github.com/RokuCommunity/roku-deploy/compare/v1.0.0...v2.0.0-beta1) - 2019-01-07
### Changed
 - removed the requirement for manifest to be located at the top of `rootDir`. Instead, it is simply assumed to exist.
### Fixed
 - regression issue that prevented folder names from being used without globs



## [1.0.0](https://github.com/RokuCommunity/roku-deploy/compare/v0.2.1...v1.0.0) - 2018-12-18
### Added
 - support for negated globs
