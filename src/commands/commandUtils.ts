import { rokuDeploy } from '../index';
import type { ConfigSectionName } from '../RokuDeployConfig';

/**
 * Build the effective options for one CLI command: load `rokudeploy.json` (from `--config` or
 * cwd), flatten it for the command (root common values overlaid with the command's section),
 * then merge the CLI args on top. Precedence: CLI args → `[command]` section → root → defaults.
 */
export function loadCommandOptions<T = any>(args: any, command: ConfigSectionName): T {
    args.cwd ??= process.cwd();
    const config = rokuDeploy.loadConfigFile({ cwd: args.cwd, configPath: args.config });
    return {
        ...rokuDeploy.resolveCommandOptions(config, command),
        ...args
    } as T;
}
