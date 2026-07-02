/**
 * Project-wide JavaScript function index via acorn AST.
 * Indexes declarations, class methods, and require() bindings for cross-file resolution.
 */

const acorn = require('acorn');
const walk = require('acorn-walk');
const path = require('path');
const fs = require('fs');
const { PATHS } = require('./constants');
const { listJsFiles, relPath, readText } = require('./scanWsFlow');

const SCAN_DIRS = [
    PATHS.clientScripts,
    path.join(PATHS.root, 'modules')
];

const SCAN_FILES = [
    path.join(PATHS.root, 'web_server.js')
];

const BUILTIN_GLOBALS = new Set([
    'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise', 'JSON', 'Math', 'Date', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
    'decodeURIComponent', 'encodeURI', 'decodeURI', 'require', 'module',
    'exports', '__dirname', '__filename', 'process', 'Buffer', 'global',
    'fetch', 'alert', 'confirm', 'prompt', 'document', 'window', 'navigator',
    'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
    'structuredClone', 'queueMicrotask', 'performance', 'Intl', 'Symbol',
    'Proxy', 'Reflect', 'BigInt', 'AbortController', 'AbortSignal', 'URL',
    'URLSearchParams', 'TextEncoder', 'TextDecoder', 'atob', 'btoa'
]);

let _indexCache = null;

function inferSide(relFile) {
    if (relFile.startsWith('public/')) return 'client';
    return 'server';
}

function resolveRequireTarget(requireArg, fromAbs) {
    if (!requireArg || requireArg.type !== 'Literal' || typeof requireArg.value !== 'string') {
        return null;
    }
    const spec = requireArg.value;
    if (!spec.startsWith('.')) return null;
    const resolved = path.resolve(path.dirname(fromAbs), spec);
    const candidates = [
        resolved,
        resolved + '.js',
        path.join(resolved, 'index.js')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
            return relPath(c);
        }
    }
    return null;
}

function fnId(file, name, line) {
    return `${file}::${name}::${line}`;
}

function parseAst(content, filePath) {
    try {
        return acorn.parse(content, {
            ecmaVersion: 'latest',
            sourceType: 'script',
            locations: true,
            allowReturnOutsideFunction: true
        });
    } catch (_e) {
        return null;
    }
}

function extractFunctionsFromAst(ast, content, relFile, side) {
    const functions = [];
    const imports = {};
    const exports = {};

    walk.simple(ast, {
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]) {
                const target = resolveRequireTarget(node.arguments[0], path.join(PATHS.root, relFile));
                if (!target) return;

                const parent = findParentDeclarator(ast, node);
                if (!parent) return;

                if (parent.id.type === 'Identifier') {
                    imports[parent.id.name] = { file: target, kind: 'default' };
                } else if (parent.id.type === 'ObjectPattern') {
                    for (const prop of parent.id.properties) {
                        if (prop.type !== 'Property') continue;
                        const local = prop.value.type === 'Identifier' ? prop.value.name : null;
                        const imported = prop.key.type === 'Identifier' ? prop.key.name : null;
                        if (local && imported) {
                            imports[local] = { file: target, kind: 'named', exportName: imported };
                        }
                    }
                }
            }
        },

        FunctionDeclaration(node) {
            if (!node.id) return;
            functions.push(makeFnEntry(node, node.id.name, relFile, side, null, content));
        },

        MethodDefinition(node) {
            if (node.kind === 'constructor') return;
            const key = node.key.type === 'Identifier' ? node.key.name : null;
            if (!key) return;
            const className = findEnclosingClassName(ast, node);
            functions.push(makeFnEntry(node.value, key, relFile, side, className, content));
        },

        VariableDeclarator(node) {
            if (!node.id || node.id.type !== 'Identifier') return;
            if (!node.init) return;
            if (node.init.type !== 'FunctionExpression' && node.init.type !== 'ArrowFunctionExpression') {
                return;
            }
            functions.push(makeFnEntry(node.init, node.id.name, relFile, side, null, content));
        }
    });

    walk.simple(ast, {
        AssignmentExpression(node) {
            if (node.left.type !== 'MemberExpression') return;
            if (node.left.object.type !== 'Identifier' || node.left.object.name !== 'module') return;
            if (node.left.property.type !== 'Identifier' || node.left.property.name !== 'exports') return;
            if (node.right.type === 'Identifier') {
                exports.default = node.right.name;
            }
        }
    });

    return { functions, imports, exports };
}

function findParentDeclarator(_ast, targetNode) {
    let found = null;
    walk.simple(_ast, {
        VariableDeclarator(node) {
            if (node.init === targetNode || (node.init && containsNode(node.init, targetNode))) {
                found = node;
            }
        }
    });
    return found;
}

function containsNode(root, target) {
    let hit = false;
    walk.simple(root, {
        CallExpression(node) {
            if (node === target) hit = true;
        }
    });
    return hit;
}

function findEnclosingClassName(ast, targetNode) {
    let className = null;
    walk.simple(ast, {
        ClassDeclaration(node) {
            if (targetNode.start >= node.start && targetNode.end <= node.end && node.id) {
                className = node.id.name;
            }
        }
    });
    return className;
}

function makeFnEntry(fnNode, name, relFile, side, className, content) {
    const line = fnNode.loc ? fnNode.loc.start.line : 1;
    let bodyNode = fnNode.body;
    if (bodyNode && bodyNode.type === 'BlockStatement') {
        bodyNode = bodyNode;
    }
    return {
        id: fnId(relFile, name, line),
        name,
        file: relFile,
        line,
        side,
        kind: className ? 'method' : 'function',
        className,
        params: (fnNode.params || []).map((p) => paramName(p)).filter(Boolean),
        bodyStart: bodyNode ? bodyNode.start : fnNode.start,
        bodyEnd: bodyNode ? bodyNode.end : fnNode.end
    };
}

function paramName(param) {
    if (param.type === 'Identifier') return param.name;
    if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') return param.left.name;
    if (param.type === 'RestElement' && param.argument.type === 'Identifier') return `...${param.argument.name}`;
    return null;
}

function scanFileForIndex(absPath) {
    const relFile = relPath(absPath);
    const content = readText(absPath);
    if (!content.trim()) return null;

    const ast = parseAst(content, absPath);
    if (!ast) return null;

    const side = inferSide(relFile);
    const { functions, imports, exports } = extractFunctionsFromAst(ast, content, relFile, side);

    return {
        file: relFile,
        side,
        content,
        ast,
        functions,
        imports,
        exports
    };
}

/**
 * Build (or return cached) project-wide function index.
 * @returns {{ byId, byName, byFile, files, builtAt }}
 */
function buildFunctionIndex(options = {}) {
    if (_indexCache && !options.refresh) return _indexCache;

    const files = new Map();
    const byId = new Map();
    const byName = new Map();
    const byFile = new Map();

    const allPaths = new Set(SCAN_FILES);
    for (const dir of SCAN_DIRS) {
        listJsFiles(dir).forEach((p) => allPaths.add(p));
    }

    for (const absPath of allPaths) {
        const scanned = scanFileForIndex(absPath);
        if (!scanned) continue;

        files.set(scanned.file, scanned);
        byFile.set(scanned.file, scanned.functions);

        for (const fn of scanned.functions) {
            byId.set(fn.id, fn);
            if (!byName.has(fn.name)) byName.set(fn.name, []);
            byName.get(fn.name).push(fn);
        }
    }

    _indexCache = {
        byId,
        byName,
        byFile,
        files,
        builtAt: new Date().toISOString(),
        counts: {
            files: files.size,
            functions: byId.size
        }
    };

    return _indexCache;
}

function clearFunctionIndexCache() {
    _indexCache = null;
}

function findFunctionsByName(name, options = {}) {
    const index = buildFunctionIndex(options);
    let matches = index.byName.get(name) || [];

    if (options.file) {
        matches = matches.filter((f) => f.file === options.file || f.file.endsWith(options.file));
    }
    if (options.side) {
        matches = matches.filter((f) => f.side === options.side);
    }

    return matches;
}

function getFileMeta(file) {
    const index = buildFunctionIndex();
    return index.files.get(file) || null;
}

function isBuiltin(name) {
    return BUILTIN_GLOBALS.has(name);
}

module.exports = {
    buildFunctionIndex,
    clearFunctionIndexCache,
    findFunctionsByName,
    getFileMeta,
    fnId,
    isBuiltin,
    BUILTIN_GLOBALS,
    SCAN_DIRS,
    SCAN_FILES
};
