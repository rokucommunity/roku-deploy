/**
 * Dependency-free date/duration formatting helpers.
 *
 * These replace the `dateformat`, `dayjs`, `moment`, and `parse-ms` packages,
 * each of which was used at a single call site for trivial formatting. This is a
 * leaf module that imports nothing else from the project, so it is safe to consume
 * from low-level files (e.g. `Logger`, `Stopwatch`) without creating import cycles.
 */

/** Left-pad a number with zeros to the given width. */
function pad(value: number, width = 2): string {
    return value.toString().padStart(width, '0');
}

/**
 * Format a date as `yymmddHHMM` (e.g. `2606291430`).
 * Reproduces `dateformat(date, 'yymmddHHMM')`.
 */
export function formatTimestampForPackage(date = new Date()): string {
    return [
        pad(date.getFullYear() % 100),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes())
    ].join('');
}

/**
 * Format a date as `YYYY-MM-DD-HH.mm.ss.SSS` (e.g. `2026-06-29-14.30.45.123`).
 * Reproduces `dayjs(date).format('YYYY-MM-DD-HH.mm.ss.SSS')`.
 */
export function formatTimestampForScreenshot(date = new Date()): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
        `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Format the current time as `hh:mm:ss:SSSS A` (e.g. `02:30:45:1234 PM`).
 * Reproduces `moment(date).format('hh:mm:ss:SSSS A')`.
 *
 * Note: the `SSSS` token in moment renders 4 fractional-second digits by
 * right-padding the millisecond value with a trailing zero.
 */
export function formatLogTimestamp(date = new Date()): string {
    const hours24 = date.getHours();
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    const meridiem = hours24 < 12 ? 'AM' : 'PM';
    const fractional = pad(date.getMilliseconds(), 3).padEnd(4, '0');
    return `${pad(hours12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${fractional} ${meridiem}`;
}

/**
 * Break a millisecond duration into time components.
 * Reproduces the `parse-ms` package.
 */
export function parseMilliseconds(milliseconds: number) {
    if (typeof milliseconds !== 'number') {
        throw new TypeError('Expected a number');
    }
    const roundTowardsZero = milliseconds > 0 ? Math.floor : Math.ceil;
    return {
        days: roundTowardsZero(milliseconds / 86400000),
        hours: roundTowardsZero(milliseconds / 3600000) % 24,
        minutes: roundTowardsZero(milliseconds / 60000) % 60,
        seconds: roundTowardsZero(milliseconds / 1000) % 60,
        milliseconds: roundTowardsZero(milliseconds) % 1000,
        microseconds: roundTowardsZero(milliseconds * 1000) % 1000,
        nanoseconds: roundTowardsZero(milliseconds * 1e6) % 1000
    };
}
