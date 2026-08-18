import { expect } from 'chai';
import * as childProcess from 'child_process';
import * as path from 'path';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const rootDir = path.resolve(__dirname, '..');

/**
 * These tests guard the public API surface. They build the project's type declarations and then run
 * API Extractor in "production" mode (local=false), which:
 *   1. fails if any exported symbol is missing a release tag (so nothing can leak in untagged), and
 *   2. fails if the generated API report differs from the committed `api/roku-deploy.api.md` (drift detection).
 *
 * If one of these fails because of an *intentional* API change, run `npm run api:build-and-update`
 * and commit the updated `api/roku-deploy.api.md`.
 */
describe('public API surface (api-extractor)', function apiExtractorSuite() {
    //compiling + analyzing can take a while on slow CI machines
    this.timeout(120000);

    before(() => {
        //api-extractor consumes the compiled .d.ts files, so the project must be built first.
        //Run the locally-installed tsc by invoking its JS entry point through the current node
        //binary. This avoids the fragile `.cmd`/PATH shim resolution that `npx`/`tsc.cmd` rely on,
        //and we deliberately don't run the full `npm run build` to avoid recursing into the
        //api-extractor check (which is exactly what this test exercises in-process).
        const tscEntry = require.resolve('typescript/bin/tsc');
        const result = childProcess.spawnSync(
            process.execPath,
            [tscEntry, '--project', path.join(rootDir, 'tsconfig.json')],
            { cwd: rootDir, encoding: 'utf8', env: process.env }
        );
        expect(result.status, `\`tsc\` failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`).to.equal(0);
    });

    /**
     * Invoke API Extractor in-process against our config, in production (non-local) mode.
     */
    function runApiExtractor() {
        const config = ExtractorConfig.loadFileAndPrepare(
            path.join(rootDir, 'api-extractor.jsonc')
        );
        return Extractor.invoke(config, {
            //production mode: do NOT overwrite the committed report, just compare against it
            localBuild: false,
            showVerboseMessages: false
        });
    }

    it('has no untagged exports and no API drift', () => {
        const result = runApiExtractor();

        //`succeeded` is false if any error-level message fired. Our config makes a missing release tag
        //(ae-missing-release-tag), a forgotten export (ae-forgotten-export), and report drift all hard
        //errors, so this single assertion covers "everything is explicitly @public/@internal", "no
        //internal type leaks into the public API", and "the committed report is current".
        expect(
            result.succeeded,
            'API Extractor reported errors. Either an export is missing a @public/@internal release tag, ' +
            'an internal type leaked into the public API, or the public API changed. If the change is ' +
            'intentional, run `npm run api:build-and-update` and commit the updated api/roku-deploy.api.md.'
        ).to.equal(true);
    });
});
