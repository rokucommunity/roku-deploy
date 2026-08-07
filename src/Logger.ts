/**
 * Backwards-compatibility shim.
 *
 * roku-deploy 3.18.0 migrated its logging to `@rokucommunity/logger` and deleted this module, which broke
 * consumers that deep-import `roku-deploy/dist/Logger` (most notably brighterscript's `ProgramBuilder`).
 * This module restores that import path by re-exporting the equivalents from `@rokucommunity/logger`:
 *
 * - `LogLevel` here is `@rokucommunity/logger`'s `LogLevelNumeric`, which has the exact same member names
 *   and numeric values (off=0 through trace=6) as the enum that used to live in this file. Because it is
 *   the same declaration used by `RokuDeployOptions['logLevel']`, values of this type remain assignable
 *   everywhere the old enum was accepted.
 * - `Logger` is `@rokucommunity/logger`'s `Logger` class, which carries the same core surface the old
 *   class had (`logLevel` get/set, `error`/`warn`/`log`/`info`/`debug`/`trace`, and `time`).
 *
 * @deprecated import from '@rokucommunity/logger' instead. This module exists only so older consumers
 * keep compiling and will be removed in the next major version.
 */

/** @deprecated use `LogLevelNumeric` from '@rokucommunity/logger' instead */
export { LogLevelNumeric as LogLevel } from '@rokucommunity/logger';

/** @deprecated use `Logger` from '@rokucommunity/logger' instead */
export { Logger } from '@rokucommunity/logger';

/** @deprecated this helper is no longer used by roku-deploy */
export function noop() {
}
