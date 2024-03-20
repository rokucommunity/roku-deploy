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
