/**
 * Server-side workspace theme CSS generation and compilation.
 * modules/workspaceCssGenerator.js
 * modules/runtimeAssetCompiler.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const workspaceCssGenerator = require('./workspaceCssGenerator');
const runtimeAssetCompiler = require('./runtimeAssetCompiler');
const runtimeAssetMemory = require('./runtimeAssetMemory');

const WEB_PATH = '/css/workspaces.css';
const SOURCE_REL = 'virtual/public/css/workspaces.css';
const SOURCE_CACHE_DIR = 'workspace-css';

let projectRoot = null;
let getWorkspacesConfig = null;
let compileCssSource = null;
let hashSource = null;
let buildHeader = null;
let atomicWrite = null;
let onCompiledCallback = null;

let recompileTimer = null;
let recompileInProgress = false;
let lastSourceHash = null;

function hydrateLastSourceHashFromDisk(root) {
    const compiledPath = getCompiledPath(root);
    if (!compiledPath || !fs.existsSync(compiledPath)) {
        return;
    }
    const existing = runtimeAssetCompiler.readExistingSourceHash(compiledPath);
    if (existing) {
        lastSourceHash = existing;
    }
}

function init(options = {}) {
    projectRoot = options.projectRoot || null;
    getWorkspacesConfig = options.getWorkspacesConfig || null;
    compileCssSource = options.compileCssSource || null;
    hashSource = options.hashSource || null;
    buildHeader = options.buildHeader || null;
    atomicWrite = options.atomicWrite || null;
    onCompiledCallback = options.onCompiled || null;
    sourceHashMemo.clear();
    if (projectRoot) {
        hydrateLastSourceHashFromDisk(projectRoot);
    }
}

function isInitialized() {
    return !!(projectRoot && typeof compileCssSource === 'function');
}

function ensureInitialized(options = {}) {
    if (isInitialized()) {
        return true;
    }
    if (!options.projectRoot || typeof options.compileCssSource !== 'function') {
        return false;
    }
    init(options);
    return isInitialized();
}

function buildSkippedCompileResult(compiledPath, sourceHash) {
    const output = fs.readFileSync(compiledPath);
    return {
        status: 'skipped',
        webPath: WEB_PATH,
        sourceHash,
        servedHash: crypto.createHash('sha256').update(output).digest('hex'),
        compiledPath
    };
}

function rememberWorkspaceCss(output) {
    runtimeAssetMemory.remember(WEB_PATH, output, { optimized: true });
}

// Disk can be current while the served copy is still the previous compile.
// A wallpaper change then broadcasts a new hash and the client stores the old bytes under it.
async function healWorkspaceCssMemory(compiledPath, sourceHash, options) {
    if (runtimeAssetMemory.headerSourceHash(WEB_PATH) === sourceHash) {
        return;
    }
    let output;
    try {
        output = fs.readFileSync(compiledPath);
    } catch (_) {
        return;
    }
    rememberWorkspaceCss(output);
    if (options && options.broadcast === false) {
        return;
    }
    if (typeof onCompiledCallback !== 'function') {
        return;
    }
    await onCompiledCallback({
        status: 'compiled',
        webPath: WEB_PATH,
        sourceHash,
        servedHash: crypto.createHash('sha256').update(output).digest('hex'),
        compiledPath
    }, options);
}

function getClientCssHash(root) {
    try {
        return resolveSourceHash(root) || null;
    } catch (_) {
        return null;
    }
}

// workspace_list and every client update asked for this hash with an open+read of the
// compiled header (#620). Keep the hash per file, keyed by a stat signature: compiles
// here and external precompiles both rewrite the file, and a rewrite changes the stat.
const sourceHashMemo = new Map();

function fileStatSignature(filePath) {
    try {
        const st = fs.statSync(filePath);
        return `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (_) {
        return null;
    }
}

function memoizedFileHash(filePath, compute) {
    const sig = fileStatSignature(filePath);
    if (!sig) {
        sourceHashMemo.delete(filePath);
        return { exists: false, hash: null };
    }
    const hit = sourceHashMemo.get(filePath);
    if (hit && hit.sig === sig) {
        return { exists: true, hash: hit.hash };
    }
    const hash = compute();
    sourceHashMemo.set(filePath, { sig, hash });
    return { exists: true, hash };
}

function resolveSourceHash(root) {
    const targetRoot = root || projectRoot;
    if (!targetRoot) {
        return null;
    }

    const compiledPath = getCompiledPath(targetRoot);
    if (compiledPath) {
        const { hash: fromHeader } = memoizedFileHash(
            compiledPath,
            () => runtimeAssetCompiler.readExistingSourceHash(compiledPath)
        );
        if (fromHeader) {
            return fromHeader;
        }
    }

    const sourceCachePath = getSourceCachePath(targetRoot);
    if (sourceCachePath) {
        const { exists, hash } = memoizedFileHash(sourceCachePath, () => {
            const source = fs.readFileSync(sourceCachePath, 'utf8');
            return typeof hashSource === 'function'
                ? hashSource(source)
                : crypto.createHash('sha256').update(source).digest('hex');
        });
        if (exists) {
            return hash;
        }
    }

    return null;
}

function getSourceCachePath(root) {
    return path.join(root || projectRoot, '.cache', SOURCE_CACHE_DIR, 'workspaces.css');
}

function getCompiledPath(root) {
    return path.join(root || projectRoot, '.cache', 'runtime-assets', 'css', 'workspaces.css');
}

function generateSourceCss(workspacesConfig) {
    const config = workspacesConfig
        || (typeof getWorkspacesConfig === 'function' ? getWorkspacesConfig() : null);
    return workspaceCssGenerator.generateAllWorkspacesCss(config);
}

async function compileWorkspaceCss(options = {}) {
    const root = options.projectRoot || projectRoot;
    if (!root || typeof compileCssSource !== 'function') {
        throw new Error('workspaceCssService: not initialized');
    }

    if (recompileInProgress && !options.force) {
        return { status: 'busy' };
    }

    recompileInProgress = true;
    try {
        const source = generateSourceCss(options.workspacesConfig);
        const sourceHash = typeof hashSource === 'function'
            ? hashSource(source)
            : crypto.createHash('sha256').update(source).digest('hex');

        const sourceCachePath = getSourceCachePath(root);
        const compiledPath = getCompiledPath(root);

        if (!options.force) {
            const existingSourceHash = fs.existsSync(compiledPath)
                ? runtimeAssetCompiler.readExistingSourceHash(compiledPath)
                : null;
            if (existingSourceHash === sourceHash) {
                lastSourceHash = sourceHash;
                await healWorkspaceCssMemory(compiledPath, sourceHash, options);
                return buildSkippedCompileResult(compiledPath, sourceHash);
            }
            if (lastSourceHash === sourceHash && fs.existsSync(compiledPath)) {
                await healWorkspaceCssMemory(compiledPath, sourceHash, options);
                return buildSkippedCompileResult(compiledPath, sourceHash);
            }
        }

        if (typeof atomicWrite === 'function') {
            atomicWrite(sourceCachePath, source);
        } else {
            fs.mkdirSync(path.dirname(sourceCachePath), { recursive: true });
            fs.writeFileSync(sourceCachePath, source, 'utf8');
        }

        const output = await compileCssSource(source, SOURCE_REL, sourceHash, {
            dedupeLiterals: true,
            runId: options.runId
        });

        if (typeof atomicWrite === 'function') {
            atomicWrite(compiledPath, output);
        } else {
            fs.mkdirSync(path.dirname(compiledPath), { recursive: true });
            fs.writeFileSync(compiledPath, output, 'utf8');
        }

        lastSourceHash = sourceHash;
        rememberWorkspaceCss(output);

        const result = {
            status: 'compiled',
            webPath: WEB_PATH,
            sourceHash,
            servedHash: crypto.createHash('sha256').update(output).digest('hex'),
            compiledPath,
            sourceBytes: Buffer.byteLength(source, 'utf8'),
            outputBytes: Buffer.byteLength(output, 'utf8')
        };

        if (typeof onCompiledCallback === 'function') {
            await onCompiledCallback(result, options);
        }

        return result;
    } finally {
        recompileInProgress = false;
    }
}

function scheduleRecompile(options = {}) {
    if (!isInitialized()) {
        return;
    }
    if (recompileTimer) {
        clearTimeout(recompileTimer);
    }
    recompileTimer = setTimeout(() => {
        recompileTimer = null;
        if (!isInitialized()) {
            return;
        }
        compileWorkspaceCss(options).catch((err) => {
            console.error('[Workspace CSS] Recompile failed:', err.message);
        });
    }, options.debounceMs != null ? options.debounceMs : 400);
}

function resolveServedPath(root) {
    const compiled = getCompiledPath(root);
    if (fs.existsSync(compiled)) {
        return compiled;
    }
    return null;
}

function isWorkspaceCssPath(webPath) {
    return webPath === WEB_PATH;
}

function getManifestEntry(root) {
    const compiledPath = getCompiledPath(root);
    if (!compiledPath || !fs.existsSync(compiledPath)) {
        return null;
    }
    const hash = resolveSourceHash(root);
    if (!hash) {
        return null;
    }
    const stats = fs.statSync(compiledPath);
    return {
        path: WEB_PATH,
        hash,
        size: stats.size,
        modified: stats.mtime.getTime()
    };
}

module.exports = {
    WEB_PATH,
    SOURCE_REL,
    init,
    isInitialized,
    ensureInitialized,
    generateSourceCss,
    compileWorkspaceCss,
    scheduleRecompile,
    resolveServedPath,
    isWorkspaceCssPath,
    getManifestEntry,
    resolveSourceHash,
    getClientCssHash,
    getCompiledPath,
    getSourceCachePath
};
