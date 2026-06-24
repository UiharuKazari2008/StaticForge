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

function updateHtmlStylesheetShaLinks(root) {
    const targetRoot = root || projectRoot;
    if (!targetRoot) {
        return;
    }
    const publicRoot = runtimeAssetCompiler.getPublicRoot(targetRoot);

    for (const name of HTML_SHA_LINK_FILES) {
        const htmlPath = path.join(publicRoot, name);
        if (!fs.existsSync(htmlPath)) {
            continue;
        }

        let content = fs.readFileSync(htmlPath, 'utf8');
        let changed = false;
        const updated = content.replace(
            /<link\b([^>]*?)>/gi,
            (full, attrs) => {
                if (!/\brel\s*=\s*["']stylesheet["']/i.test(attrs)) {
                    return full;
                }
                const hrefMatch = attrs.match(/\bhref\s*=\s*["'](\/css\/[^"']+)["']/i);
                if (!hrefMatch) {
                    return full;
                }
                const cssPath = hrefMatch[1].split('?')[0];
                let hash;
                if (cssPath === runtimeAssetCompiler.WORKSPACE_CSS_WEB_PATH) {
                    const workspaceCssService = require('./workspaceCssService');
                    hash = workspaceCssService.resolveSourceHash(targetRoot);
                } else {
                    const servedPath = resolveServedAssetPath(targetRoot, cssPath);
                    if (!servedPath || !fs.existsSync(servedPath)) {
                        return full;
                    }
                    hash = hashServedFile(servedPath);
                }
                if (!hash) {
                    return full;
                }
                const nextHref = `${cssPath}?sha=${hash}`;
                const nextAttrs = attrs.replace(/\bhref\s*=\s*["'][^"']+["']/i, `href="${nextHref}"`);
                if (nextAttrs === attrs) {
                    return full;
                }
                changed = true;
                return `<link${nextAttrs}>`;
            }
        );

        if (changed && updated !== content) {
            runtimeAssetCompiler.atomicWrite(htmlPath, updated);
        }
    }
}

function resolveServedAssetPath(root, webPath) {
    const targetRoot = root || projectRoot;
    if (!targetRoot) {
        return null;
    }
    return runtimeAssetCompiler.resolveServedPath(targetRoot, webPath, false);
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

    if (options.refreshCache !== false && typeof refreshCacheCallback === 'function') {
        await refreshCacheCallback();
    }

    updateHtmlStylesheetShaLinks(options.projectRoot || projectRoot);

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
    hashServedFile,
    updateHtmlStylesheetShaLinks,
    resolveServedAssetPath,
    compileOnBoot,
    recompileAndRefresh,
    refreshHashCacheAndBroadcast,
    ensureCompiledForRequest,
    getStatus,
    getPublicStatus,
    isAutoRecompileEnabled,
    ...runtimeAssetCompiler
};
