/**
 * Repo-local ESLint rules, loaded through `eslint-plugin-local-rules`.
 */
const fs = require('fs');
const path = require('path');

const RELEASE_TAG = /@(?:public|internal)\b/;
const INDEX_PATH = path.join(__dirname, 'src', 'index.ts');

/**
 * Map of module basename to the names `src/index.ts` re-exports from it (`'*'` for `export *`).
 * Only these modules form the package's public API, so only they need release tags.
 *
 * Read fresh on every call instead of cached: index.ts is ~700 bytes, so re-reading it per linted
 * file is immeasurable, and a module-level cache would go stale in a long-lived editor ESLint
 * server (a newly index-exported module would not be flagged until the server restarted).
 *
 * Note: ESLint's own cross-file result cache (`eslint --cache`, used by editors) keys a file's
 * result on that file's own contents, so a file that *becomes* public by an index.ts edit may not
 * be re-linted until it changes. No in-rule change can fix that, and it does not affect CI, which
 * runs without a persisted cache.
 */
function getPublicModules() {
    const modules = new Map();
    const source = fs.readFileSync(INDEX_PATH, 'utf8');
    for (const match of source.matchAll(/^export (\*|\{([^}]*)\}) from '\.\/(\w+)';/gm)) {
        const names = match[1] === '*' ? '*' : new Set(match[2].split(',').map(x => x.trim()).filter(Boolean));
        modules.set(match[3], names);
    }
    return modules;
}

/**
 * Whether the JSDoc block directly above `node` carries a `@public` or `@internal` release tag.
 */
function hasReleaseTag(sourceCode, node) {
    //`getJSDocComment()` only understands a handful of node types, so find the docblock by hand
    const comments = sourceCode.getCommentsBefore(node);
    const docblock = comments.reverse().find((comment) => comment.type === 'Block' && comment.value.startsWith('*'));
    return !!docblock && RELEASE_TAG.test(docblock.value);
}

/**
 * Whether a class member is visible to consumers: not a constructor, not `private`/`protected`,
 * and not a `#private` name.
 */
function isPublicMember(node) {
    if (node.kind === 'constructor') {
        return false;
    }
    if (node.accessibility === 'private' || node.accessibility === 'protected') {
        return false;
    }
    return node.key.type !== 'PrivateIdentifier';
}

module.exports = {
    'require-release-tag': {
        meta: {
            type: 'problem',
            docs: {
                description: 'require an explicit @public or @internal release tag on every declaration the package exports and on every public member of an exported class'
            },
            schema: [],
            messages: {
                missing: "'{{name}}' is part of the public API but has no @public or @internal release tag"
            }
        },
        create(context) {
            const filename = context.filename ?? context.getFilename();
            const exportedNames = getPublicModules().get(path.basename(filename, '.ts'));
            if (!exportedNames) {
                return {};
            }
            const sourceCode = context.sourceCode ?? context.getSourceCode();

            function isExported(name) {
                return exportedNames === '*' || exportedNames.has(name);
            }

            function report(node, name) {
                context.report({ node: node.key ?? node.id ?? node, messageId: 'missing', data: { name } });
            }

            function checkClassMembers(classNode) {
                //overload signatures share the first signature's docblock, so check each name once
                const seen = new Set();
                for (const member of classNode.body.body) {
                    if (!isPublicMember(member)) {
                        continue;
                    }
                    const name = sourceCode.getText(member.key);
                    if (seen.has(name)) {
                        continue;
                    }
                    seen.add(name);
                    if (!hasReleaseTag(sourceCode, member)) {
                        report(member, name);
                    }
                }
            }

            return {
                ExportNamedDeclaration(node) {
                    const declaration = node.declaration;
                    if (!declaration) {
                        return;
                    }
                    //the docblock for a declaration sits above the `export` keyword
                    const tagged = hasReleaseTag(sourceCode, node);
                    if (declaration.type === 'VariableDeclaration') {
                        for (const declarator of declaration.declarations) {
                            const name = sourceCode.getText(declarator.id);
                            if (isExported(name) && !tagged) {
                                report(declarator, name);
                            }
                        }
                        return;
                    }
                    if (!declaration.id || !isExported(declaration.id.name)) {
                        return;
                    }
                    if (!tagged) {
                        report(declaration, declaration.id.name);
                    }
                    if (declaration.type === 'ClassDeclaration') {
                        checkClassMembers(declaration);
                    }
                }
            };
        }
    }
};
