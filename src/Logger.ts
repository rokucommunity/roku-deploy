/**
 * Backwards-compatibility shim: roku-deploy 3.18.0 migrated logging to `@rokucommunity/logger` and
 * deleted this module, breaking consumers that deep-import `roku-deploy/dist/Logger` (most notably
 * brighterscript's `ProgramBuilder`). This restores that import path by re-exporting the equivalents:
 * `LogLevel` is `LogLevelNumeric` (same member names and numeric values as the old enum) and
 * `Logger` is the `Logger` class (same core surface).
 *
 * @deprecated import from '@rokucommunity/logger' instead. This module exists only so older
 * consumers keep compiling and will be removed in the next major version.
 */

/** @deprecated use `LogLevelNumeric` from '@rokucommunity/logger' instead */
export { LogLevelNumeric as LogLevel } from '@rokucommunity/logger';

/** @deprecated use `Logger` from '@rokucommunity/logger' instead */
export { Logger } from '@rokucommunity/logger';

/** @deprecated this helper is no longer used by roku-deploy */
export function noop() {
}
