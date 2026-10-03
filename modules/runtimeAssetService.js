const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimeAssetCompiler = require('./runtimeAssetCompiler');

const SERVED_HASH_ALGO = 'sha256';
const HTML_SHA_LINK_FILES = ['app.html', 'launch.html'];

let projectRoot = null;
let refreshCacheCallback = null;
let broadcastErrorsCallback = null;
let broadcastManifestCallback = null;
let getAutoRecompileCallback = null;
let broadcastCompleteCallback = null;

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
        const updated = content
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

        // Cache only — never write runtime ?sha= into git-tracked public/*.html
        const cachePath = path.join(outputRoot, name);
        if (!fs.existsSync(cachePath) || fs.readFileSync(cachePath, 'utf8') !== updated) {
            runtimeAssetCompiler.atomicWrite(cachePath, updated);
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

module.exports = {
    init,
    SERVED_HASH_ALGO,
    HTML_SHA_LINK_FILES,
    hashServedFile,
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
    resolveServedAssetPath
};
