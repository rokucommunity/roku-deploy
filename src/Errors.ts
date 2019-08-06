export class InvalidDeviceResponseCodeError extends Error {
    constructor(message: string, results?: any) {
        super(message);
        results = results;
        Object.setPrototypeOf(this, InvalidDeviceResponseCodeError.prototype);
    }
}

export class UnauthorizedDeviceResponseError extends Error {
    public results: any;

    constructor(message: string, results?: any) {
        super(message);
        results = results;
        Object.setPrototypeOf(this, UnauthorizedDeviceResponseError.prototype);
    }
}

export class UnparsableDeviceResponseError extends Error {
    public results: any;

    constructor(message: string, results?: any) {
        super(message);
        results = results;
        Object.setPrototypeOf(this, UnparsableDeviceResponseError.prototype);
    }
}

export class FailedDeviceResponseError extends Error {
    public results: any;

    constructor(message: string, results?: any) {
        super(message);
        results = results;
        Object.setPrototypeOf(this, FailedDeviceResponseError.prototype);
    }
}

export class UnknownDeviceResponseError extends Error {
    constructor(message: string, results?: any) {
        super(message);
        results = results;
        Object.setPrototypeOf(this, UnknownDeviceResponseError.prototype);
    }
}

export class CompileError extends Error {
    public results: any;

    constructor(message: string, results: any) {
        super(message);
        results = results;
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
