import * as path from 'path';
import * as fsExtra from 'fs-extra';

/**
 * Absolute path of the fully-commented sample config that ships in the package. Resolved relative to this
 * module so it works both from `src/` (ts-node) and from `dist/` (the published build).
 */
export const sampleConfigPath = path.resolve(__dirname, '../../src/rokudeploy.sample.jsonc');

export class InitCommand {
    run(args: { cwd?: string; force?: boolean }) {
        const cwd = args.cwd ?? process.cwd();
        const target = path.resolve(cwd, 'rokudeploy.json');
        if (fsExtra.existsSync(target) && !args.force) {
            throw new Error(`rokudeploy.json already exists at "${target}". Pass --force to overwrite it.`);
        }
        fsExtra.copyFileSync(sampleConfigPath, target);
        console.log(`Created ${target}`);
    }
}
