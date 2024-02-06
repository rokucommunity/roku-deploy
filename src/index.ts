import { RokuDeploy } from './RokuDeploy';

//export everything from the RokuDeploy file
export * from './RokuDeploy';
export * from './util';
export * from './RokuDeployOptions';
export * from './Errors';
export * from './DeviceInfo';

//create a new static instance of RokuDeploy, and export those functions for backwards compatibility
export const rokuDeploy = new RokuDeploy();
