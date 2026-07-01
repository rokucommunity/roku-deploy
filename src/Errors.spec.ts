import { expect } from 'chai';
import {
    RokuDeployError,
    RokuDeployErrorCode,
    DeviceError,
    ConfigurationError,
    InvalidDeviceResponseCodeError,
    UnauthorizedDeviceResponseError,
    FailedDeviceResponseError,
    UnparsableDeviceResponseError,
    UnknownDeviceResponseError,
    DeviceUnreachableError,
    EcpNetworkAccessModeDisabledError,
    UpdateCheckRequiredError,
    ConnectionResetError,
    CompileError,
    ConvertError,
    MissingRequiredOptionError,
    InvalidOptionError,
    UnsupportedFirmwareVersionError,
    isRokuDeployError,
    isDeviceError,
    isConfigurationError,
    hasErrorCode,
    isUpdateCheckRequiredError,
    isConnectionResetError,
    isCompileError,
    isUnauthorizedError,
    extractHttpResponseDetails
} from './Errors';
import type {
    DeviceErrorDetails,
    ConnectionErrorDetails,
    UnsupportedFirmwareDetails
} from './Errors';

describe('Errors', () => {
    describe('RokuDeployError base class', () => {
        it('sets the error name to the class name', () => {
            const error = new InvalidDeviceResponseCodeError('test message');
            expect(error.name).to.equal('InvalidDeviceResponseCodeError');
        });

        it('stores the message', () => {
            const error = new InvalidDeviceResponseCodeError('test message');
            expect(error.message).to.equal('test message');
        });

        it('stores details when provided', () => {
            const details: DeviceErrorDetails = {
                host: '192.168.1.100',
                httpResponse: {
                    statusCode: 500,
                    body: 'error body'
                }
            };
            const error = new InvalidDeviceResponseCodeError('test message', details);
            expect(error.details).to.deep.equal(details);
        });

        it('provides empty object as default details', () => {
            const error = new InvalidDeviceResponseCodeError('test message');
            expect(error.details).to.deep.equal({});
        });

        it('stores cause when provided', () => {
            const cause = new Error('original error');
            const error = new InvalidDeviceResponseCodeError('test message', {}, cause);
            expect(error.cause).to.equal(cause);
        });

        it('supports instanceof checks', () => {
            const error = new InvalidDeviceResponseCodeError('test');
            expect(error instanceof Error).to.be.true;
            expect(error instanceof RokuDeployError).to.be.true;
            expect(error instanceof DeviceError).to.be.true;
            expect(error instanceof InvalidDeviceResponseCodeError).to.be.true;
        });

        it('has stack trace', () => {
            const error = new InvalidDeviceResponseCodeError('test');
            expect(error.stack).to.be.a('string');
            expect(error.stack).to.include('InvalidDeviceResponseCodeError');
        });

        describe('toJSON()', () => {
            it('serializes the error to JSON', () => {
                const details: DeviceErrorDetails = {
                    host: '192.168.1.100',
                    httpResponse: {
                        statusCode: 500
                    }
                };
                const error = new InvalidDeviceResponseCodeError('test message', details);
                const json = error.toJSON();

                expect(json.name).to.equal('InvalidDeviceResponseCodeError');
                expect(json.code).to.equal(RokuDeployErrorCode.INVALID_RESPONSE_CODE);
                expect(json.message).to.equal('test message');
                expect(json.details).to.deep.equal(details);
                expect(json.stack).to.be.a('string');
                expect(json.cause).to.be.undefined;
            });

            it('serializes cause when present', () => {
                const cause = new Error('original error');
                const error = new InvalidDeviceResponseCodeError('test', {}, cause);
                const json = error.toJSON();

                expect(json.cause).to.deep.equal({
                    name: 'Error',
                    message: 'original error',
                    stack: cause.stack
                });
            });
        });
    });

    describe('DeviceError intermediate class', () => {
        it('provides rokuMessages getter', () => {
            const rokuMessages = {
                errors: ['compile error'],
                infos: ['info message'],
                successes: []
            };
            const error = new FailedDeviceResponseError('test', {
                rokuMessages: rokuMessages
            });
            expect(error.rokuMessages).to.deep.equal(rokuMessages);
        });

        it('provides host getter', () => {
            const error = new FailedDeviceResponseError('test', {
                host: '192.168.1.100'
            });
            expect(error.host).to.equal('192.168.1.100');
        });

        it('returns undefined for missing rokuMessages', () => {
            const error = new FailedDeviceResponseError('test', {});
            expect(error.rokuMessages).to.be.undefined;
        });
    });

    describe('ConfigurationError intermediate class', () => {
        it('provides optionName getter', () => {
            const error = new MissingRequiredOptionError('test', {
                optionName: 'host'
            });
            expect(error.optionName).to.equal('host');
        });
    });

    describe('Concrete Error Classes', () => {
        describe('InvalidDeviceResponseCodeError', () => {
            it('has correct error code', () => {
                const error = new InvalidDeviceResponseCodeError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.INVALID_RESPONSE_CODE);
            });
        });

        describe('UnauthorizedDeviceResponseError', () => {
            it('has correct error code', () => {
                const error = new UnauthorizedDeviceResponseError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.UNAUTHORIZED);
            });
        });

        describe('FailedDeviceResponseError', () => {
            it('has correct error code', () => {
                const error = new FailedDeviceResponseError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.FAILED_RESPONSE);
            });
        });

        describe('UnparsableDeviceResponseError', () => {
            it('has correct error code', () => {
                const error = new UnparsableDeviceResponseError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.UNPARSABLE_RESPONSE);
            });
        });

        describe('UnknownDeviceResponseError', () => {
            it('has correct error code', () => {
                const error = new UnknownDeviceResponseError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.UNKNOWN_RESPONSE);
            });
        });

        describe('DeviceUnreachableError', () => {
            it('has correct error code', () => {
                const error = new DeviceUnreachableError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.DEVICE_UNREACHABLE);
            });
        });

        describe('EcpNetworkAccessModeDisabledError', () => {
            it('has correct error code', () => {
                const error = new EcpNetworkAccessModeDisabledError('test');
                expect(error.code).to.equal(RokuDeployErrorCode.ECP_DISABLED);
            });
        });

        describe('UpdateCheckRequiredError', () => {
            it('has correct error code', () => {
                const error = new UpdateCheckRequiredError();
                expect(error.code).to.equal(RokuDeployErrorCode.UPDATE_CHECK_REQUIRED);
            });

            it('uses static MESSAGE', () => {
                const error = new UpdateCheckRequiredError();
                expect(error.message).to.equal(UpdateCheckRequiredError.MESSAGE);
            });

            it('stores connection details', () => {
                const details: ConnectionErrorDetails = {
                    url: 'http://192.168.1.100/plugin_install',
                    host: '192.168.1.100'
                };
                const error = new UpdateCheckRequiredError(details);
                expect(error.details).to.deep.equal(details);
            });
        });

        describe('ConnectionResetError', () => {
            it('has correct error code', () => {
                const error = new ConnectionResetError();
                expect(error.code).to.equal(RokuDeployErrorCode.CONNECTION_RESET);
            });

            it('uses static MESSAGE', () => {
                const error = new ConnectionResetError();
                expect(error.message).to.equal(ConnectionResetError.MESSAGE);
            });

            it('stores cause', () => {
                const originalError = new Error('ECONNRESET');
                const error = new ConnectionResetError({ host: '192.168.1.100' }, originalError);
                expect(error.cause).to.equal(originalError);
            });
        });

        describe('CompileError', () => {
            it('has correct error code', () => {
                const error = new CompileError('Compile error');
                expect(error.code).to.equal(RokuDeployErrorCode.COMPILE_ERROR);
            });

            it('provides rokuMessages getter', () => {
                const rokuMessages = {
                    errors: ['syntax error line 10'],
                    infos: [],
                    successes: []
                };
                const error = new CompileError('Compile error', {
                    rokuMessages: rokuMessages
                });
                expect(error.rokuMessages).to.deep.equal(rokuMessages);
            });
        });

        describe('ConvertError', () => {
            it('has correct error code', () => {
                const error = new ConvertError('Conversion failed');
                expect(error.code).to.equal(RokuDeployErrorCode.CONVERT_ERROR);
            });
        });

        describe('MissingRequiredOptionError', () => {
            it('has correct error code', () => {
                const error = new MissingRequiredOptionError('Missing host');
                expect(error.code).to.equal(RokuDeployErrorCode.MISSING_REQUIRED_OPTION);
            });

            it('is a ConfigurationError', () => {
                const error = new MissingRequiredOptionError('Missing host');
                expect(error instanceof ConfigurationError).to.be.true;
            });
        });

        describe('InvalidOptionError', () => {
            it('has correct error code', () => {
                const error = new InvalidOptionError('Invalid port');
                expect(error.code).to.equal(RokuDeployErrorCode.INVALID_OPTION);
            });
        });

        describe('UnsupportedFirmwareVersionError', () => {
            it('has correct error code', () => {
                const error = new UnsupportedFirmwareVersionError('Unsupported version');
                expect(error.code).to.equal(RokuDeployErrorCode.UNSUPPORTED_FIRMWARE);
            });

            it('stores firmware details', () => {
                const details: UnsupportedFirmwareDetails = {
                    currentVersion: '14.0.0',
                    minimumVersion: '15.0.4',
                    operation: 'reboot'
                };
                const error = new UnsupportedFirmwareVersionError('Unsupported version', details);
                expect(error.details).to.deep.equal(details);
            });
        });
    });

    describe('Type Guard Functions', () => {
        describe('isRokuDeployError', () => {
            it('returns true for RokuDeployError instances', () => {
                expect(isRokuDeployError(new InvalidDeviceResponseCodeError('test'))).to.be.true;
                expect(isRokuDeployError(new CompileError('test'))).to.be.true;
                expect(isRokuDeployError(new MissingRequiredOptionError('test'))).to.be.true;
            });

            it('returns false for regular Error', () => {
                expect(isRokuDeployError(new Error('test'))).to.be.false;
            });

            it('returns false for non-errors', () => {
                expect(isRokuDeployError(null)).to.be.false;
                expect(isRokuDeployError(undefined)).to.be.false;
                expect(isRokuDeployError('string')).to.be.false;
                expect(isRokuDeployError({})).to.be.false;
            });
        });

        describe('isDeviceError', () => {
            it('returns true for DeviceError instances', () => {
                expect(isDeviceError(new InvalidDeviceResponseCodeError('test'))).to.be.true;
                expect(isDeviceError(new UnauthorizedDeviceResponseError('test'))).to.be.true;
                expect(isDeviceError(new FailedDeviceResponseError('test'))).to.be.true;
            });

            it('returns false for non-DeviceError RokuDeployErrors', () => {
                expect(isDeviceError(new CompileError('test'))).to.be.false;
                expect(isDeviceError(new MissingRequiredOptionError('test'))).to.be.false;
            });
        });

        describe('isConfigurationError', () => {
            it('returns true for ConfigurationError instances', () => {
                expect(isConfigurationError(new MissingRequiredOptionError('test'))).to.be.true;
                expect(isConfigurationError(new InvalidOptionError('test'))).to.be.true;
            });

            it('returns false for non-ConfigurationError RokuDeployErrors', () => {
                expect(isConfigurationError(new InvalidDeviceResponseCodeError('test'))).to.be.false;
                expect(isConfigurationError(new CompileError('test'))).to.be.false;
            });
        });

        describe('hasErrorCode', () => {
            it('returns true when code matches', () => {
                const error = new InvalidDeviceResponseCodeError('test');
                expect(hasErrorCode(error, RokuDeployErrorCode.INVALID_RESPONSE_CODE)).to.be.true;
            });

            it('returns false when code does not match', () => {
                const error = new InvalidDeviceResponseCodeError('test');
                expect(hasErrorCode(error, RokuDeployErrorCode.UNAUTHORIZED)).to.be.false;
            });

            it('returns false for non-RokuDeployError', () => {
                expect(hasErrorCode(new Error('test'), RokuDeployErrorCode.INVALID_RESPONSE_CODE)).to.be.false;
            });
        });

        describe('isUpdateCheckRequiredError', () => {
            it('returns true for UpdateCheckRequiredError', () => {
                expect(isUpdateCheckRequiredError(new UpdateCheckRequiredError())).to.be.true;
            });

            it('returns false for other errors', () => {
                expect(isUpdateCheckRequiredError(new ConnectionResetError())).to.be.false;
                expect(isUpdateCheckRequiredError(new Error('test'))).to.be.false;
            });
        });

        describe('isConnectionResetError', () => {
            it('returns true for ConnectionResetError', () => {
                expect(isConnectionResetError(new ConnectionResetError())).to.be.true;
            });

            it('returns false for other errors', () => {
                expect(isConnectionResetError(new UpdateCheckRequiredError())).to.be.false;
                expect(isConnectionResetError(new Error('test'))).to.be.false;
            });
        });

        describe('isCompileError', () => {
            it('returns true for CompileError', () => {
                expect(isCompileError(new CompileError('test'))).to.be.true;
            });

            it('returns false for other errors', () => {
                expect(isCompileError(new ConvertError('test'))).to.be.false;
                expect(isCompileError(new Error('test'))).to.be.false;
            });
        });

        describe('isUnauthorizedError', () => {
            it('returns true for UnauthorizedDeviceResponseError', () => {
                expect(isUnauthorizedError(new UnauthorizedDeviceResponseError('test'))).to.be.true;
            });

            it('returns false for other errors', () => {
                expect(isUnauthorizedError(new InvalidDeviceResponseCodeError('test'))).to.be.false;
                expect(isUnauthorizedError(new Error('test'))).to.be.false;
            });
        });
    });

    describe('extractHttpResponseDetails', () => {
        it('extracts details from response object', () => {
            const response = {
                statusCode: 200,
                headers: { 'content-type': 'text/html' },
                request: {
                    uri: { href: 'http://192.168.1.100/plugin_install' },
                    method: 'POST'
                }
            };
            const body = '<html>response body</html>';

            const details = extractHttpResponseDetails(response, body);

            expect(details).to.deep.equal({
                url: 'http://192.168.1.100/plugin_install',
                method: 'POST',
                statusCode: 200,
                headers: { 'content-type': 'text/html' },
                body: body
            });
        });

        it('returns undefined for undefined response', () => {
            expect(extractHttpResponseDetails(undefined, 'body')).to.be.undefined;
        });

        it('handles partial response object', () => {
            const response = {
                statusCode: 500
            };
            const details = extractHttpResponseDetails(response, 'error body');

            expect(details).to.deep.equal({
                url: undefined,
                method: undefined,
                statusCode: 500,
                headers: undefined,
                body: 'error body'
            });
        });
    });

    describe('RokuDeployErrorCode enum', () => {
        it('has all expected codes', () => {
            expect(RokuDeployErrorCode.INVALID_RESPONSE_CODE).to.equal('INVALID_RESPONSE_CODE');
            expect(RokuDeployErrorCode.UNAUTHORIZED).to.equal('UNAUTHORIZED');
            expect(RokuDeployErrorCode.FAILED_RESPONSE).to.equal('FAILED_RESPONSE');
            expect(RokuDeployErrorCode.UNPARSABLE_RESPONSE).to.equal('UNPARSABLE_RESPONSE');
            expect(RokuDeployErrorCode.UNKNOWN_RESPONSE).to.equal('UNKNOWN_RESPONSE');
            expect(RokuDeployErrorCode.DEVICE_UNREACHABLE).to.equal('DEVICE_UNREACHABLE');
            expect(RokuDeployErrorCode.ECP_DISABLED).to.equal('ECP_DISABLED');
            expect(RokuDeployErrorCode.UPDATE_CHECK_REQUIRED).to.equal('UPDATE_CHECK_REQUIRED');
            expect(RokuDeployErrorCode.CONNECTION_RESET).to.equal('CONNECTION_RESET');
            expect(RokuDeployErrorCode.COMPILE_ERROR).to.equal('COMPILE_ERROR');
            expect(RokuDeployErrorCode.CONVERT_ERROR).to.equal('CONVERT_ERROR');
            expect(RokuDeployErrorCode.MISSING_REQUIRED_OPTION).to.equal('MISSING_REQUIRED_OPTION');
            expect(RokuDeployErrorCode.INVALID_OPTION).to.equal('INVALID_OPTION');
            expect(RokuDeployErrorCode.UNSUPPORTED_FIRMWARE).to.equal('UNSUPPORTED_FIRMWARE');
        });
    });
});
