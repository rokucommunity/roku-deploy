import type { HttpResponse, RokuMessages } from './RokuDeploy';
import type * as requestType from 'request';

export interface RequestResult {
    response: requestType.Response;
    body: any;
}
export class InvalidDeviceResponseCodeError extends Error {
    constructor(message: string, public results?: RequestResult) {
        super(message);
        Object.setPrototypeOf(this, InvalidDeviceResponseCodeError.prototype);
    }
}

export class UnauthorizedDeviceResponseError extends Error {
    constructor(message: string, results?: any) {
        super(message);
        Object.setPrototypeOf(this, UnauthorizedDeviceResponseError.prototype);
    }
}

export class UnparsableDeviceResponseError extends Error {
    constructor(message: string, results?: any) {
        super(message);
        Object.setPrototypeOf(this, UnparsableDeviceResponseError.prototype);
    }
}

export class FailedDeviceResponseError extends Error {
    constructor(message: string, results?: any) {
        super(message);
        Object.setPrototypeOf(this, FailedDeviceResponseError.prototype);
    }
}

export class UnknownDeviceResponseError extends Error {
    constructor(message: string, results?: any) {
        super(message);
        Object.setPrototypeOf(this, UnknownDeviceResponseError.prototype);
    }
}

export class CompileError extends Error {
    constructor(message: string, results: any, rokuMessages: RokuMessages) {
        super(message);
        Object.setPrototypeOf(this, CompileError.prototype);
    }
}

export class ConvertError extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, ConvertError.prototype);
    }
}

export class MissingRequiredOptionError extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, MissingRequiredOptionError.prototype);
    }
}

/**
 * This error is thrown when a Roku device refuses to accept connections because it requires the user to check for updates (even if no updates are actually available).
 */
export class UpdateCheckRequiredError extends Error {

    static MESSAGE = `Your device needs to check for updates before accepting connections. Please navigate to System Settings and check for updates and then try again.\n\nhttps://support.roku.com/article/208755668.`;

    constructor(
        public response: HttpResponse,
        public requestOptions: requestType.OptionsWithUrl,
        public cause?: Error
    ) {
        super();
        this.message = UpdateCheckRequiredError.MESSAGE;
        Object.setPrototypeOf(this, UpdateCheckRequiredError.prototype);
    }
}

export function isUpdateCheckRequiredError(e: any): e is UpdateCheckRequiredError {
    return e?.constructor?.name === 'UpdateCheckRequiredError';
}

/**
 * This error is thrown when a Roku device ends the connection unexpectedly, causing an 'ECONNRESET' error. Typically this happens when the device needs to check for updates (even if no updates are available), but it can also happen for other reasons.
 */
export class ConnectionResetError extends Error {

    static MESSAGE = `The Roku device ended the connection unexpectedly and may need to check for updates before accepting connections. Please navigate to System Settings and check for updates and then try again.\n\nhttps://support.roku.com/article/208755668.`;

    constructor(error: Error, requestOptions: requestType.OptionsWithUrl) {
        super();
        this.message = ConnectionResetError.MESSAGE;
        this.cause = error;
        Object.setPrototypeOf(this, ConnectionResetError.prototype);
    }

    public cause?: Error;
}

export function isConnectionResetError(e: any): e is ConnectionResetError {
    return e?.constructor?.name === 'ConnectionResetError';
}
