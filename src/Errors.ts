import type { RokuMessages } from './RokuDeploy';

/**
 * Error codes for all RokuDeploy errors.
 * These provide programmatic identification of error types.
 */
export enum RokuDeployErrorCode {
    INVALID_RESPONSE_CODE = 'INVALID_RESPONSE_CODE',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FAILED_RESPONSE = 'FAILED_RESPONSE',
    UNPARSABLE_RESPONSE = 'UNPARSABLE_RESPONSE',
    UNKNOWN_RESPONSE = 'UNKNOWN_RESPONSE',
    DEVICE_UNREACHABLE = 'DEVICE_UNREACHABLE',
    ECP_DISABLED = 'ECP_DISABLED',
    UPDATE_CHECK_REQUIRED = 'UPDATE_CHECK_REQUIRED',
    CONNECTION_RESET = 'CONNECTION_RESET',
    COMPILE_ERROR = 'COMPILE_ERROR',
    CONVERT_ERROR = 'CONVERT_ERROR',
    MISSING_REQUIRED_OPTION = 'MISSING_REQUIRED_OPTION',
    INVALID_OPTION = 'INVALID_OPTION',
    UNSUPPORTED_FIRMWARE = 'UNSUPPORTED_FIRMWARE'
}

/**
 * Abstracted HTTP request details - NOT tied to request library.
 * This allows switching from postman-request to native fetch later.
 */
export interface HttpRequestDetails {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
}

/**
 * Abstracted HTTP response details - NOT tied to request library.
 * This allows switching from postman-request to native fetch later.
 */
export interface HttpResponseDetails {
    statusCode?: number;
    headers?: Record<string, string>;
    body?: string | Buffer;
}

/**
 * Combined HTTP details containing both request and response information.
 */
export interface HttpDetails {
    request?: HttpRequestDetails;
    response?: HttpResponseDetails;
}

/**
 * Details for device communication errors
 */
export interface DeviceErrorDetails {
    httpDetails?: HttpDetails;
    rokuMessages?: RokuMessages;
    host?: string;
}

/**
 * Details for network/connection errors
 */
export interface ConnectionErrorDetails {
    cause?: Error;
    host?: string;
    url?: string;
}

/**
 * Details for configuration errors
 */
export interface ConfigurationErrorDetails {
    optionName?: string;
    providedValue?: unknown;
    expectedFormat?: string;
}

/**
 * Details for compile errors (same as device errors)
 * rokuMessages.errors contains compile error messages
 */
export type CompileErrorDetails = DeviceErrorDetails;

/**
 * Details for convert errors
 */
export interface ConvertErrorDetails {
    httpDetails?: HttpDetails;
    rokuMessages?: RokuMessages;
}

/**
 * Details for unsupported firmware errors
 */
export interface UnsupportedFirmwareDetails {
    currentVersion?: string;
    minimumVersion?: string;
    operation?: string;
}

/**
 * Base class for all RokuDeploy errors.
 * Provides consistent error handling with typed details and serialization support.
 */
export abstract class RokuDeployError<T = unknown> extends Error {
    /**
     * Error code for programmatic identification
     */
    public abstract readonly code: RokuDeployErrorCode;

    /**
     * Typed details specific to this error type
     */
    public readonly details: T;

    /**
     * Original error if this error wraps another
     */
    public readonly cause?: Error;

    constructor(message: string, details?: T, cause?: Error) {
        super(message);
        this.name = this.constructor.name;
        this.details = details ?? {} as T;
        this.cause = cause;
        // Restore prototype chain for proper instanceof checks
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     * Serialize the error for logging/transmission
     */
    public toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            cause: this.cause ? {
                name: this.cause.name,
                message: this.cause.message,
                stack: this.cause.stack
            } : undefined,
            stack: this.stack
        };
    }
}

/**
 * Intermediate base class for device communication errors.
 * These errors occur when communicating with a Roku device.
 */
export abstract class DeviceError extends RokuDeployError<DeviceErrorDetails> {
    /**
     * Roku messages extracted from the device response
     */
    public get rokuMessages(): RokuMessages | undefined {
        return this.details?.rokuMessages;
    }

    /**
     * The host/IP of the device
     */
    public get host(): string | undefined {
        return this.details?.host;
    }
}

/**
 * Intermediate base class for configuration errors.
 */
export abstract class ConfigurationError extends RokuDeployError<ConfigurationErrorDetails> {
    /**
     * The name of the option that caused the error
     */
    public get optionName(): string | undefined {
        return this.details?.optionName;
    }
}

// ============================================================================
// Concrete Error Classes
// ============================================================================

/**
 * Thrown when the device returns an unexpected HTTP status code
 */
export class InvalidDeviceResponseCodeError extends DeviceError {
    public readonly code = RokuDeployErrorCode.INVALID_RESPONSE_CODE;
}

/**
 * Thrown when authentication fails (HTTP 401)
 */
export class UnauthorizedDeviceResponseError extends DeviceError {
    public readonly code = RokuDeployErrorCode.UNAUTHORIZED;
}

/**
 * Thrown when the device returns an error message in the response body
 */
export class FailedDeviceResponseError extends DeviceError {
    public readonly code = RokuDeployErrorCode.FAILED_RESPONSE;
}

/**
 * Thrown when the device response cannot be parsed
 */
export class UnparsableDeviceResponseError extends DeviceError {
    public readonly code = RokuDeployErrorCode.UNPARSABLE_RESPONSE;
}

/**
 * Thrown when the device returns an unexpected response that doesn't fit other categories
 */
export class UnknownDeviceResponseError extends DeviceError {
    public readonly code = RokuDeployErrorCode.UNKNOWN_RESPONSE;
}

/**
 * Thrown when the device cannot be reached
 */
export class DeviceUnreachableError extends DeviceError {
    public readonly code = RokuDeployErrorCode.DEVICE_UNREACHABLE;
}

/**
 * Thrown when ECP (External Control Protocol) is disabled on the device
 */
export class EcpNetworkAccessModeDisabledError extends DeviceError {
    public readonly code = RokuDeployErrorCode.ECP_DISABLED;
}

/**
 * Thrown when a Roku device refuses to accept connections because it requires
 * the user to check for updates (even if no updates are actually available).
 */
export class UpdateCheckRequiredError extends RokuDeployError<ConnectionErrorDetails> {
    public readonly code = RokuDeployErrorCode.UPDATE_CHECK_REQUIRED;

    static MESSAGE = `Your device needs to check for updates before accepting connections. Please navigate to System Settings and check for updates and then try again.\n\nhttps://support.roku.com/article/208755668.`;

    constructor(details?: ConnectionErrorDetails, cause?: Error) {
        super(UpdateCheckRequiredError.MESSAGE, details, cause);
    }
}

/**
 * Thrown when a Roku device ends the connection unexpectedly (ECONNRESET).
 * Typically this happens when the device needs to check for updates,
 * but it can also happen for other reasons.
 */
export class ConnectionResetError extends RokuDeployError<ConnectionErrorDetails> {
    public readonly code = RokuDeployErrorCode.CONNECTION_RESET;

    static MESSAGE = `The Roku device ended the connection unexpectedly and may need to check for updates before accepting connections. Please navigate to System Settings and check for updates and then try again.\n\nhttps://support.roku.com/article/208755668.`;

    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(details?: ConnectionErrorDetails, cause?: Error) {
        super(ConnectionResetError.MESSAGE, details, cause);
    }
}

/**
 * Thrown when compilation fails during sideload
 */
export class CompileError extends RokuDeployError<CompileErrorDetails> {
    public readonly code = RokuDeployErrorCode.COMPILE_ERROR;

    /**
     * Roku messages extracted from the device response.
     * The `errors` array contains compile error messages.
     */
    public get rokuMessages(): RokuMessages | undefined {
        return this.details?.rokuMessages;
    }
}

/**
 * Thrown when squashfs conversion fails
 */
export class ConvertError extends RokuDeployError<ConvertErrorDetails> {
    public readonly code = RokuDeployErrorCode.CONVERT_ERROR;
}

/**
 * Thrown when a required option is missing
 */
export class MissingRequiredOptionError extends ConfigurationError {
    public readonly code = RokuDeployErrorCode.MISSING_REQUIRED_OPTION;
}

/**
 * Thrown when an option has an invalid value
 */
export class InvalidOptionError extends ConfigurationError {
    public readonly code = RokuDeployErrorCode.INVALID_OPTION;
}

/**
 * Thrown when the device firmware version doesn't support the requested operation
 */
export class UnsupportedFirmwareVersionError extends RokuDeployError<UnsupportedFirmwareDetails> {
    public readonly code = RokuDeployErrorCode.UNSUPPORTED_FIRMWARE;
}

// ============================================================================
// Type Guard Functions
// ============================================================================

/**
 * Check if an error is a RokuDeployError
 */
export function isRokuDeployError(e: unknown): e is RokuDeployError {
    return e instanceof RokuDeployError;
}

/**
 * Check if an error is a DeviceError
 */
export function isDeviceError(e: unknown): e is DeviceError {
    return e instanceof DeviceError;
}

/**
 * Check if an error is a ConfigurationError
 */
export function isConfigurationError(e: unknown): e is ConfigurationError {
    return e instanceof ConfigurationError;
}

/**
 * Check if an error has a specific error code
 */
export function hasErrorCode<T extends RokuDeployErrorCode>(
    e: unknown,
    code: T
): e is RokuDeployError & { code: T } {
    return isRokuDeployError(e) && e.code === code;
}

/**
 * Check if an error is an UpdateCheckRequiredError
 */
export function isUpdateCheckRequiredError(e: unknown): e is UpdateCheckRequiredError {
    return e instanceof UpdateCheckRequiredError;
}

/**
 * Check if an error is a ConnectionResetError
 */
export function isConnectionResetError(e: unknown): e is ConnectionResetError {
    return e instanceof ConnectionResetError;
}

/**
 * Check if an error is a CompileError
 */
export function isCompileError(e: unknown): e is CompileError {
    return e instanceof CompileError;
}

/**
 * Check if an error is an UnauthorizedDeviceResponseError
 */
export function isUnauthorizedError(e: unknown): e is UnauthorizedDeviceResponseError {
    return e instanceof UnauthorizedDeviceResponseError;
}

/**
 * Check if an error is an InvalidDeviceResponseCodeError
 */
export function isInvalidDeviceResponseCodeError(e: unknown): e is InvalidDeviceResponseCodeError {
    return e instanceof InvalidDeviceResponseCodeError;
}

/**
 * Check if an error is a FailedDeviceResponseError
 */
export function isFailedDeviceResponseError(e: unknown): e is FailedDeviceResponseError {
    return e instanceof FailedDeviceResponseError;
}

/**
 * Check if an error is an UnparsableDeviceResponseError
 */
export function isUnparsableDeviceResponseError(e: unknown): e is UnparsableDeviceResponseError {
    return e instanceof UnparsableDeviceResponseError;
}

/**
 * Check if an error is an UnknownDeviceResponseError
 */
export function isUnknownDeviceResponseError(e: unknown): e is UnknownDeviceResponseError {
    return e instanceof UnknownDeviceResponseError;
}

/**
 * Check if an error is a DeviceUnreachableError
 */
export function isDeviceUnreachableError(e: unknown): e is DeviceUnreachableError {
    return e instanceof DeviceUnreachableError;
}

/**
 * Check if an error is an EcpNetworkAccessModeDisabledError
 */
export function isEcpNetworkAccessModeDisabledError(e: unknown): e is EcpNetworkAccessModeDisabledError {
    return e instanceof EcpNetworkAccessModeDisabledError;
}

/**
 * Check if an error is a ConvertError
 */
export function isConvertError(e: unknown): e is ConvertError {
    return e instanceof ConvertError;
}

/**
 * Check if an error is a MissingRequiredOptionError
 */
export function isMissingRequiredOptionError(e: unknown): e is MissingRequiredOptionError {
    return e instanceof MissingRequiredOptionError;
}

/**
 * Check if an error is an InvalidOptionError
 */
export function isInvalidOptionError(e: unknown): e is InvalidOptionError {
    return e instanceof InvalidOptionError;
}

/**
 * Check if an error is an UnsupportedFirmwareVersionError
 */
export function isUnsupportedFirmwareVersionError(e: unknown): e is UnsupportedFirmwareVersionError {
    return e instanceof UnsupportedFirmwareVersionError;
}

// ============================================================================
// Helper function
// ============================================================================

/**
 * Extract HttpDetails from a request library response.
 * This abstracts the response format so we can switch HTTP libraries later.
 */
export function extractHttpDetails(
    response: { statusCode?: number; headers?: Record<string, string>; request?: { uri?: { href?: string }; method?: string; headers?: Record<string, string> } } | undefined,
    body?: string | Buffer
): HttpDetails | undefined {
    if (!response) {
        return undefined;
    }
    return {
        request: {
            url: response.request?.uri?.href,
            method: response.request?.method,
            headers: response.request?.headers
        },
        response: {
            statusCode: response.statusCode,
            headers: response.headers,
            body: body
        }
    };
}
