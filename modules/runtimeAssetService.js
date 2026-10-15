const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimeAssetCompiler = require('./runtimeAssetCompiler');
const runtimeAssetMemory = require('./runtimeAssetMemory');

const SERVED_HASH_ALGO = 'sha256';
const HTML_SHA_LINK_FILES = ['app.html', 'launch.html'];

let projectRoot = null;
let refreshCacheCallback = null;
let broadcastErrorsCallback = null;
let broadcastManifestCallback = null;
let getAutoRecompileCallback = null;
let broadcastCompleteCallback = null;
let primePromise = null;

function init(options = {}) {
    projectRoot = options.projectRoot || null;
    refreshCacheCallback = options.refreshCache || null;
    broadcastErrorsCallback = options.broadcastErrors || null;
    broadcastManifestCallback = options.broadcastManifest || null;
    getAutoRecompileCallback = options.getAutoRecompile || null;
    broadcastCompleteCallback = options.broadcastComplete || null;

    runtimeAssetCompiler.setProgressBroadcastCallback((progress) => {
        if (typeof options.broadcastProgress === 'function') {
            options.broadcastProgress(progress);
        }
    });
}

function isAutoRecompileEnabled() {
    if (typeof getAutoRecompileCallback === 'function') {
        return getAutoRecompileCallback() === true;
    }
    return false;
}

function hashServedFile(absPath) {
    const fileBuffer = fs.readFileSync(absPath);
    return crypto.createHash(SERVED_HASH_ALGO).update(fileBuffer).digest('hex');
}

function hashServedFileIfChanged(absPath, stats, cachedEntry) {
    const modified = stats.mtime.getTime();
    if (cachedEntry
        && cachedEntry.hash
        && cachedEntry.size === stats.size
        && cachedEntry.modified === modified) {
        return cachedEntry.hash;
    }
    return hashServedFile(absPath);
}

async function hashServedFileIfChangedAsync(absPath, stats, cachedEntry) {
    const modified = stats.mtime.getTime();
    if (cachedEntry
        && cachedEntry.hash
        && cachedEntry.size === stats.size
        && cachedEntry.modified === modified) {
        return cachedEntry.hash;
    }
    const fileBuffer = await fs.promises.readFile(absPath);
    return crypto.createHash(SERVED_HASH_ALGO).update(fileBuffer).digest('hex');
}

function isHtmlShaLinkWebPath(webPath) {
    const name = String(webPath || '').replace(/^\//, '');
    return HTML_SHA_LINK_FILES.includes(name);
}

function resolveServedHtmlPath(root, name) {
    const targetRoot = root || projectRoot;
    if (!targetRoot || !name) {
        return null;
    }
    const cachePath = path.join(runtimeAssetCompiler.getOutputRoot(targetRoot), name);
    if (fs.existsSync(cachePath)) {
        return cachePath;
    }
    const publicPath = path.join(runtimeAssetCompiler.getPublicRoot(targetRoot), name);
    if (fs.existsSync(publicPath)) {
        return publicPath;
    }
    return null;
}

function normalizePageAssetPath(raw) {
    let url = String(raw || '').trim();
    if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) {
        return null;
    }
    url = url.split('#')[0].split('?')[0];
    if (url.startsWith('./')) {
        url = url.slice(2);
    }
    if (!url.startsWith('/')) {
        url = `/${url}`;
    }
    return url;
}

const PAGE_ASSET_FILES = {
    '/protected/fflate.js': ['node_modules', 'fflate', 'umd', 'index.js']
};

function hashForPageAsset(targetRoot, webPath) {
    if (webPath === runtimeAssetCompiler.WORKSPACE_CSS_WEB_PATH) {
        const headerHash = runtimeAssetMemory.headerSourceHash(webPath);
        if (headerHash) {
            return headerHash;
        }
    } else {
        const served = runtimeAssetMemory.servedHash(webPath);
        if (served) {
            return served;
        }
    }
    const override = PAGE_ASSET_FILES[webPath];
    if (override) {
        const abs = path.join(targetRoot, ...override);
        if (!fs.existsSync(abs)) {
            return null;
        }
        return hashServedFile(abs);
    }
    if (webPath === runtimeAssetCompiler.WORKSPACE_CSS_WEB_PATH) {
        const workspaceCssService = require('./workspaceCssService');
        return workspaceCssService.resolveSourceHash(targetRoot);
    }
    const servedPath = resolveServedAssetPath(targetRoot, webPath);
    if (!servedPath || !fs.existsSync(servedPath)) {
        return null;
    }
    return hashServedFile(servedPath);
}

function rewriteHashedAssetAttr(attrs, attrName, targetRoot) {
    const match = attrs.match(new RegExp(`\\b${attrName}\\s*=\\s*(["'])([^"']+)\\1`, 'i'));
    if (!match) {
        return attrs;
    }
    const webPath = normalizePageAssetPath(match[2]);
    if (!webPath) {
        return attrs;
    }
    const hash = hashForPageAsset(targetRoot, webPath);
    if (!hash) {
        return attrs;
    }
    const nextUrl = `${webPath}?sha=${hash}`;
    if (match[2] === nextUrl) {
        return attrs;
    }
    return attrs.replace(match[0], `${attrName}=${match[1]}${nextUrl}${match[1]}`);
}

function rewriteHtmlAssetUrls(content, targetRoot) {
    return content
        .replace(/<link\b([^>]*?)>/gi, (full, attrs) => {
            if (!/\brel\s*=\s*["']stylesheet["']/i.test(attrs)) {
                return full;
            }
            const nextAttrs = rewriteHashedAssetAttr(attrs, 'href', targetRoot);
            return nextAttrs === attrs ? full : `<link${nextAttrs}>`;
        })
        .replace(/<script\b([^>]*?)>/gi, (full, attrs) => {
            if (!/\bsrc\s*=/i.test(attrs)) {
                return full;
            }
            const nextAttrs = rewriteHashedAssetAttr(attrs, 'src', targetRoot);
            return nextAttrs === attrs ? full : `<script${nextAttrs}>`;
        });
}

function collectPageAssetUrls(content) {
    const urls = [];
    const pattern = /\b(?:href|src)\s*=\s*(["'])([^"']+)\1/gi;
    let match = pattern.exec(content);
    while (match) {
        const webPath = normalizePageAssetPath(match[2]);
        if (webPath) {
            urls.push(webPath);
        }
        match = pattern.exec(content);
    }
    return urls;
}

async function readAssetBytesForHash(targetRoot, webPath) {
    const override = PAGE_ASSET_FILES[webPath];
    if (override) {
        return fs.promises.readFile(path.join(targetRoot, ...override));
    }
    const compiled = runtimeAssetCompiler.webPathToCompiledPath(targetRoot, webPath);
    try {
        return await fs.promises.readFile(compiled);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
    const pub = path.join(runtimeAssetCompiler.getPublicRoot(targetRoot), webPath.replace(/^\//, ''));
    return fs.promises.readFile(pub);
}

async function prehashHtmlContent(targetRoot, content) {
    const urls = collectPageAssetUrls(content);
    for (const webPath of urls) {
        if (webPath === runtimeAssetCompiler.WORKSPACE_CSS_WEB_PATH) {
            continue;
        }
        if (runtimeAssetMemory.servedHash(webPath)) {
            continue;
        }
        try {
            const buf = await readAssetBytesForHash(targetRoot, webPath);
            runtimeAssetMemory.rememberHash(
                webPath,
                crypto.createHash('sha256').update(buf).digest('hex')
            );
        } catch (err) {
            if (err.code !== 'ENOENT' && err.code !== 'EISDIR') {
                throw err;
            }
        }
    }
}

async function prehashTrackedHtml(targetRoot) {
    const publicRoot = runtimeAssetCompiler.getPublicRoot(targetRoot);
    for (const name of HTML_SHA_LINK_FILES) {
        try {
            const content = await fs.promises.readFile(path.join(publicRoot, name), 'utf8');
            await prehashHtmlContent(targetRoot, content);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }
}

function updateHtmlStylesheetShaLinks(root) {
    const targetRoot = root || projectRoot;
    if (!targetRoot) {
        return;
    }
    const publicRoot = runtimeAssetCompiler.getPublicRoot(targetRoot);
    const outputRoot = runtimeAssetCompiler.getOutputRoot(targetRoot);

    for (const name of HTML_SHA_LINK_FILES) {
        const htmlPath = path.join(publicRoot, name);
        if (!fs.existsSync(htmlPath)) {
            continue;
        }

        const content = fs.readFileSync(htmlPath, 'utf8');
        const updated = rewriteHtmlAssetUrls(content, targetRoot);

        // Cache only — never write runtime ?sha= into git-tracked public/*.html
        const cachePath = path.join(outputRoot, name);
        if (!fs.existsSync(cachePath) || fs.readFileSync(cachePath, 'utf8') !== updated) {
            runtimeAssetCompiler.atomicWrite(cachePath, updated);
        }
    }
}

async function rebuildHtmlFileAsync(targetRoot, webPath) {
    const name = String(webPath || '').replace(/^\//, '');
    if (!HTML_SHA_LINK_FILES.includes(name)) {
        return null;
    }
    const htmlPath = path.join(runtimeAssetCompiler.getPublicRoot(targetRoot), name);
    let content;
    try {
        content = await fs.promises.readFile(htmlPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
    await prehashHtmlContent(targetRoot, content);
    const updated = rewriteHtmlAssetUrls(content, targetRoot);
    const cachePath = path.join(runtimeAssetCompiler.getOutputRoot(targetRoot), name);
    await runtimeAssetCompiler.atomicWriteAsync(cachePath, updated);
    return runtimeAssetMemory.remember(`/${name}`, updated, { optimized: true });
}

async function refreshRememberedHtmlAndWorkspace(targetRoot) {
    const outputRoot = runtimeAssetCompiler.getOutputRoot(targetRoot);
    try {
        await runtimeAssetMemory.rememberAbs(
            path.join(outputRoot, 'css/workspaces.css'),
            '/css/workspaces.css'
        );
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
    updateHtmlStylesheetShaLinks(targetRoot);
    for (const name of HTML_SHA_LINK_FILES) {
        try {
            await runtimeAssetMemory.rememberAbs(path.join(outputRoot, name), `/${name}`);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }
}

function resolveServedPath(root, webPath, debugMode) {
    const targetRoot = root || projectRoot;
    if (targetRoot && isHtmlShaLinkWebPath(webPath)) {
        const name = String(webPath).replace(/^\//, '');
        return resolveServedHtmlPath(targetRoot, name)
            || path.join(runtimeAssetCompiler.getPublicRoot(targetRoot), name);
    }
    return runtimeAssetCompiler.resolveServedPath(targetRoot, webPath, debugMode);
}

function resolveServedAssetPath(root, webPath) {
    const targetRoot = root || projectRoot;
    if (!targetRoot) {
        return null;
    }
    return resolveServedPath(targetRoot, webPath, false);
}

async function runCompile(targetRoot, options = {}) {
    if (!targetRoot) {
        throw new Error('runtimeAssetService: projectRoot is required');
    }
    return runtimeAssetCompiler.compileRuntimeAssets(targetRoot, {
        force: options.force === true,
        showConsoleProgress: options.showConsoleProgress !== false,
        waitIfBusy: options.waitIfBusy
    });
}

async function compileWorkspaceCssAssets(targetRoot, options = {}) {
    try {
        const workspaceCssService = require('./workspaceCssService');
        return await workspaceCssService.compileWorkspaceCss({
            projectRoot: targetRoot,
            force: options.force === true,
            runId: options.runId,
            broadcast: options.broadcastWorkspaceCss !== false
        });
    } catch (err) {
        console.warn('[Workspace CSS] compile failed:', err.message);
        return null;
    }
}

async function postCompileActions(result, options = {}) {
    const compileResult = result || {
        compiled: 0,
        skipped: 0,
        errors: [],
        stats: null
    };

    if (compileResult.waited) {
        return compileResult;
    }

    updateHtmlStylesheetShaLinks(options.projectRoot || projectRoot);

    if (options.refreshCache !== false && typeof refreshCacheCallback === 'function') {
        await refreshCacheCallback();
    }

    const errors = Array.isArray(compileResult.errors) ? compileResult.errors : [];
    if (errors.length > 0 && typeof broadcastErrorsCallback === 'function') {
        broadcastErrorsCallback(compileResult);
    }

    if (options.broadcastManifest === true && typeof broadcastManifestCallback === 'function') {
        await broadcastManifestCallback(options);
    }

    if (options.broadcastComplete !== false && typeof broadcastCompleteCallback === 'function') {
        broadcastCompleteCallback(compileResult);
    }

    if (options.compileWorkspaceCss !== false && !compileResult.waited) {
        const targetRoot = options.projectRoot || projectRoot;
        await compileWorkspaceCssAssets(targetRoot, {
            force: options.force === true,
            runId: compileResult.runId,
            broadcastWorkspaceCss: false
        });
    }

    const memoryRoot = options.projectRoot || projectRoot;
    if (memoryRoot) {
        await refreshRememberedHtmlAndWorkspace(memoryRoot);
    }

    return compileResult;
}

async function compileOnBoot(root, options = {}) {
    const targetRoot = root || projectRoot;
    const result = await runCompile(targetRoot, options);
    return postCompileActions(result, {
        ...options,
        refreshCache: true,
        broadcastManifest: false,
        broadcastComplete: options.broadcastComplete !== false
    });
}

async function recompileAndRefresh(options = {}) {
    const targetRoot = options.projectRoot || projectRoot;
    const result = await runCompile(targetRoot, options);
    return postCompileActions(result, {
        ...options,
        refreshCache: true,
        broadcastManifest: true,
        broadcastComplete: options.broadcastComplete !== false
    });
}

async function refreshHashCacheAndBroadcast(options = {}) {
    return postCompileActions(
        { compiled: 0, skipped: 0, errors: [] },
        {
            ...options,
            refreshCache: true,
            broadcastManifest: true,
            broadcastComplete: false
        }
    );
}

async function ensureCompiledForRequest(root, webPath) {
    if (!isAutoRecompileEnabled()) {
        return { changed: false };
    }
    const targetRoot = root || projectRoot;
    if (!targetRoot) {
        return { changed: false };
    }
    const result = await runtimeAssetCompiler.ensureCompiledForRequest(targetRoot, webPath);
    if (result.changed) {
        await postCompileActions(
            { compiled: 1, skipped: 0, errors: [] },
            { silent: true, broadcastManifest: true, broadcastComplete: false }
        );
    }
    return result;
}

function getStatus() {
    const targetRoot = projectRoot;
    return runtimeAssetCompiler.getCompileState(targetRoot);
}

function getPublicStatus() {
    const state = getStatus();
    const errors = state.errors || [];
    const stats = state.stats || {};
    const result = {
        complete: state.complete,
        inProgress: state.inProgress,
        lastRunAt: state.lastRunAt,
        compiled: state.compiled,
        failedCount: errors.length,
        progress: state.progress,
        stats: {
            totalFiles: stats.totalFiles,
            compiledFiles: stats.compiledFiles,
            bytesSaved: stats.bytesSaved,
            percentBytesSaved: stats.percentBytesSaved
        }
    };
    if (errors.length > 0) {
        result.errors = errors;
    }
    return result;
}

async function precompileRuntimeAssets(targetRoot, options) {
    if (!targetRoot) {
        throw new Error('runtimeAssetService: projectRoot is required');
    }
    const outputRoot = runtimeAssetCompiler.getOutputRoot(targetRoot);
    await runtimeAssetMemory.loadTree(outputRoot);
    const result = await runCompile(targetRoot, options);
    await runtimeAssetMemory.loadTree(outputRoot);
    await prehashTrackedHtml(targetRoot);
    updateHtmlStylesheetShaLinks(targetRoot);
    for (const name of HTML_SHA_LINK_FILES) {
        try {
            await runtimeAssetMemory.rememberAbs(path.join(outputRoot, name), `/${name}`);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }
    return result;
}

function startRuntimeAssetPrime(root, options = {}) {
    if (primePromise) {
        return primePromise;
    }
    const targetRoot = root || projectRoot;
    primePromise = precompileRuntimeAssets(targetRoot, options).catch((err) => {
        primePromise = null;
        throw err;
    });
    return primePromise;
}

function scheduleAutoRecompile(targetRoot, webPath) {
    if (!isAutoRecompileEnabled() || !runtimeAssetCompiler.isManagedWebPath(webPath)) {
        return;
    }
    const abs = runtimeAssetCompiler.webPathToSourcePath(targetRoot, webPath);
    const rel = `public${webPath}`;
    runtimeAssetCompiler.compileOneFile(targetRoot, abs, rel, { force: false }).catch((err) => {
        if (err && err.code === 'ENOENT') {
            return;
        }
        console.error(`[Runtime Compile] ${rel}: ${err.message}`);
    });
}

async function readDebugAsset(targetRoot, webPath) {
    let abs;
    if (runtimeAssetCompiler.isAppIconWebPath(webPath)) {
        const appIconRuntimeAssets = require('./appIconRuntimeAssets');
        abs = appIconRuntimeAssets.resolveServedAppIconPath(targetRoot, webPath, true);
        if (!abs) {
            return null;
        }
    } else if (isHtmlShaLinkWebPath(webPath)) {
        abs = path.join(runtimeAssetCompiler.getPublicRoot(targetRoot), webPath.replace(/^\//, ''));
    } else {
        abs = runtimeAssetCompiler.webPathToSourcePath(targetRoot, webPath);
    }
    try {
        const body = await fs.promises.readFile(abs);
        return runtimeAssetMemory.decorate(webPath, body, { optimized: false });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

async function ensureIconAsset(targetRoot, webPath) {
    const cached = runtimeAssetMemory.lookup(webPath);
    if (cached) {
        return cached;
    }
    const compiled = path.join(runtimeAssetCompiler.getOutputRoot(targetRoot), webPath.replace(/^\//, ''));
    try {
        return await runtimeAssetMemory.rememberAbs(compiled, webPath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
    const appIconRuntimeAssets = require('./appIconRuntimeAssets');
    await appIconRuntimeAssets.ensureCompiledForRequest(targetRoot, webPath);
    try {
        return await runtimeAssetMemory.rememberAbs(compiled, webPath);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

function lookupRuntimeAsset(webPath) {
    return runtimeAssetMemory.lookup(webPath);
}

async function resolveRuntimeAsset(root, webPath, options = {}) {
    const targetRoot = root || projectRoot;
    const normalized = runtimeAssetMemory.normalizeWebPath(webPath);
    if (!normalized || !targetRoot) {
        return null;
    }
    if (options.debug === true) {
        return readDebugAsset(targetRoot, normalized);
    }
    const hit = runtimeAssetMemory.lookup(normalized);
    if (hit) {
        scheduleAutoRecompile(targetRoot, normalized);
        return hit;
    }
    if (isHtmlShaLinkWebPath(normalized)) {
        return runtimeAssetMemory.singleFlight(`html:${normalized}`, async () => {
            const again = runtimeAssetMemory.lookup(normalized);
            if (again) {
                return again;
            }
            return rebuildHtmlFileAsync(targetRoot, normalized);
        });
    }
    if (runtimeAssetCompiler.isAppIconWebPath(normalized)) {
        return runtimeAssetMemory.singleFlight(normalized, () => ensureIconAsset(targetRoot, normalized));
    }
    if (!runtimeAssetCompiler.isManagedWebPath(normalized)) {
        return null;
    }
    const abs = runtimeAssetCompiler.webPathToSourcePath(targetRoot, normalized);
    const rel = `public${normalized}`;
    // A missing script or stylesheet is a 404, not a compile. readFile would
    // reject ENOENT (public/scripts/blockContainer.js is not the real path).
    try {
        const sourceStat = await fs.promises.stat(abs);
        if (!sourceStat.isFile()) {
            return null;
        }
    } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
            return null;
        }
        throw err;
    }
    try {
        await runtimeAssetCompiler.compileOneFile(targetRoot, abs, rel, { force: false });
    } catch (err) {
        if (err && err.code !== 'ENOENT') {
            console.error(`[Runtime Compile] ${rel}: ${err.message}`);
        }
        return null;
    }
    return runtimeAssetMemory.lookup(normalized);
}

function clearRuntimeAssetMemory() {
    runtimeAssetMemory.clear();
    primePromise = null;
}

module.exports = {
    init,
    SERVED_HASH_ALGO,
    HTML_SHA_LINK_FILES,
    hashServedFile,
    hashServedFileIfChanged,
    hashServedFileIfChangedAsync,
    updateHtmlStylesheetShaLinks,
    isHtmlShaLinkWebPath,
    resolveServedHtmlPath,
    compileOnBoot,
    recompileAndRefresh,
    refreshHashCacheAndBroadcast,
    ensureCompiledForRequest,
    getStatus,
    getPublicStatus,
    isAutoRecompileEnabled,
    ...runtimeAssetCompiler,
    resolveServedPath,
    resolveServedAssetPath,
    startRuntimeAssetPrime,
    resolveRuntimeAsset,
    lookupRuntimeAsset,
    clearRuntimeAssetMemory
};
