import type { RokuMessages } from './RokuDeploy';

export class InvalidDeviceResponseCodeError extends Error {
    constructor(message: string, public results?: any) {
        super(message);
        Object.setPrototypeOf(this, InvalidDeviceResponseCodeError.prototype);
    }
}

export class UnauthorizedDeviceResponseError extends Error {
    constructor(message: string, public results?: any) {
        super(message);
        Object.setPrototypeOf(this, UnauthorizedDeviceResponseError.prototype);
    }
}

export class UnparsableDeviceResponseError extends Error {
    constructor(message: string, public results?: any) {
        super(message);
        Object.setPrototypeOf(this, UnparsableDeviceResponseError.prototype);
    }
}

export class FailedDeviceResponseError extends Error {
    constructor(message: string, public results?: any) {
        super(message);
        Object.setPrototypeOf(this, FailedDeviceResponseError.prototype);
    }
}

export class UnknownDeviceResponseError extends Error {
    constructor(message: string, public results?: any) {
        super(message);
        Object.setPrototypeOf(this, UnknownDeviceResponseError.prototype);
    }
}

export class CompileError extends Error {
    constructor(message: string, public results: any, public rokuMessages: RokuMessages) {
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

export class UpdateCheckRequiredError extends Error {
    results: any;

    cause: Error;

    constructor(originalError: Error) {
        super();
        this.message = `Your device needs to check for updates before accepting connections. Please navigate to System Settings and check for updates and then try again.\n\nhttps://support.roku.com/article/208755668.`;
        this.results = { response: { statusCode: 577 } };
        this.cause = originalError;
        Object.setPrototypeOf(this, UpdateCheckRequiredError.prototype);
    }
}
