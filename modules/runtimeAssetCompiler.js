const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify: minifyJs } = require('terser');
const { transform: transformCss } = require('lightningcss');
const { dedupeCssLiterals } = require('./cssValueDeduper');
const runtimeCompileLogStore = require('./runtimeCompileLogStore');

const HEADER_MARKER = 'DO NOT EDIT, READ ONLY OPTIMISED VERSION';
const MANAGED_ROOTS = ['css', 'scripts'];
const WORKSPACE_CSS_WEB_PATH = '/css/workspaces.css';
const OUTPUT_SUBDIR = 'runtime-assets';
const CONSOLE_PROGRESS_WIDTH = 40;

const compileState = {
    complete: false,
    inProgress: false,
    lastRunAt: null,
    compiled: 0,
    skipped: 0,
    errors: [],
    progress: {
        current: 0,
        total: 0,
        file: null,
        percent: 0
    },
    stats: {
        totalFiles: 0,
        compiledFiles: 0,
        sourceBytes: 0,
        outputBytes: 0,
        bytesSaved: 0,
        percentBytesSaved: 0
    }
};

let progressBroadcastCallback = null;

function setProgressBroadcastCallback(fn) {
    progressBroadcastCallback = typeof fn === 'function' ? fn : null;
}

function getOutputRoot(projectRoot) {
    return path.join(projectRoot, '.cache', OUTPUT_SUBDIR);
}

function getPublicRoot(projectRoot) {
    return path.join(projectRoot, 'public');
}

function isManagedWebPath(webPath) {
    const normalized = (webPath || '').replace(/^\//, '');
    const first = normalized.split('/')[0];
    return MANAGED_ROOTS.includes(first);
}

function webPathToSourcePath(projectRoot, webPath) {
    const rel = webPath.replace(/^\//, '');
    return path.join(getPublicRoot(projectRoot), rel);
}

function webPathToCompiledPath(projectRoot, webPath) {
    const rel = webPath.replace(/^\//, '');
    return path.join(getOutputRoot(projectRoot), rel);
}

function sourcePathToRel(sourceAbsPath, projectRoot) {
    const publicRoot = getPublicRoot(projectRoot);
    const rel = path.relative(publicRoot, sourceAbsPath).replace(/\\/g, '/');
    return `public/${rel}`;
}

const SOURCE_HASH_ALGO = 'sha256';

function hashSource(content) {
    return crypto.createHash(SOURCE_HASH_ALGO).update(content).digest('hex');
}

const LIGHTNING_CSS_TARGETS = {
    chrome: 100 << 16,
    firefox: 100 << 16,
    safari: (16 << 16) | (4 << 8)
};

const LIGHTNING_CSS_TRANSFORM_OPTIONS = {
    minify: true,
    errorRecovery: true,
    targets: LIGHTNING_CSS_TARGETS,
    drafts: {
        customMedia: false
    },
    nonStandard: {
        deepSelectorCombinator: false
    }
};

let currentCompileRunId = null;
let compileLogBroadcastCallback = null;

function setCompileLogBroadcastCallback(fn) {
    compileLogBroadcastCallback = typeof fn === 'function' ? fn : null;
}

function initCompileLogStore(logsDir) {
    runtimeCompileLogStore.init({
        logsDir,
        broadcast: (payload) => {
            if (compileLogBroadcastCallback) {
                compileLogBroadcastCallback(payload);
            }
        }
    });
}

function beginCompileRun() {
    currentCompileRunId = runtimeCompileLogStore.createRunId();
    return currentCompileRunId;
}

function endCompileRun() {
    currentCompileRunId = null;
}

function pushCompileLogEntries(entries, options = {}) {
    if (!entries || entries.length === 0) {
        return;
    }
    runtimeCompileLogStore.appendEntries(entries, options);
}

function validateCssBraces(source) {
    let depth = 0;
    let inComment = false;
    let inStr = null;
    let escaped = false;

    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        const n = source[i + 1];
        if (inComment) {
            if (c === '*' && n === '/') {
                inComment = false;
                i++;
            }
            continue;
        }
        if (inStr) {
            if (!escaped && c === inStr) {
                inStr = null;
            }
            escaped = !escaped && c === '\\';
            continue;
        }
        if (c === '/' && n === '*') {
            inComment = true;
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            escaped = false;
            continue;
        }
        if (c === '{') {
            depth++;
        }
        if (c === '}') {
            if (--depth < 0) {
                throw new Error('Unmatched closing brace');
            }
        }
    }

    if (depth !== 0) {
        throw new Error(`Unmatched opening brace(s): ${depth} unclosed`);
    }
}

function validateCssNoOrphanTouchHoverBlocks(source) {
    const match = source.match(/(?:^|\n)((?:    [^\n]*(?:\n|$))+)\s*$/);
    if (!match) {
        return;
    }
    const block = match[1];
    if (!/:hover/.test(block)) {
        return;
    }

    const before = source.slice(0, source.length - match[0].length);
    let depth = 0;
    let inComment = false;
    let inStr = null;
    let escaped = false;

    for (let i = 0; i < before.length; i++) {
        const c = before[i];
        const n = before[i + 1];
        if (inComment) {
            if (c === '*' && n === '/') {
                inComment = false;
                i++;
            }
            continue;
        }
        if (inStr) {
            if (!escaped && c === inStr) {
                inStr = null;
            }
            escaped = !escaped && c === '\\';
            continue;
        }
        if (c === '/' && n === '*') {
            inComment = true;
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            escaped = false;
            continue;
        }
        if (c === '{') {
            depth++;
        }
        if (c === '}') {
            depth--;
        }
    }

    if (depth !== 0) {
        return;
    }

    const tailText = before.trimEnd().split('\n').slice(-3).join('\n');
    if (/@supports\s+not\s+\(\(-webkit-touch-callout:\s*none\)\s+or\s+\(hover:\s*hover\)\)\s*\{?\s*$/.test(tailText)) {
        return;
    }

    throw new Error('Orphaned indented :hover block at end of file (missing @supports wrapper?)');
}

function validateCssSource(source) {
    validateCssBraces(source);
    validateCssNoOrphanTouchHoverBlocks(source);
}

function collectLightningCssLogEntries(warnings, sourceRelPath, runId) {
    const entries = [];
    for (const warning of warnings || []) {
        entries.push(runtimeCompileLogStore.lightningWarningToEntry(
            warning,
            sourceRelPath,
            runId || currentCompileRunId
        ));
    }
    return entries;
}

function buildHeader(sourceRelPath, sourceHash) {
    const compiledOn = new Date().toString();
    const body = `${HEADER_MARKER} | Source file: ${sourceRelPath} | Compiled on ${compiledOn} | Source SHA256: ${sourceHash}`;
    // Block comment is valid in both JavaScript and CSS — served as-is without stripping
    return `/* ${body} */`;
}

function normalizeHeaderText(headerText) {
    if (!headerText) {
        return '';
    }
    let line = headerText.trim();
    if (line.startsWith('/*')) {
        line = line.replace(/^\/\*\s*/, '').replace(/\s*\*\/\s*$/, '');
    } else if (line.startsWith('//')) {
        line = line.replace(/^\/\/\s*/, '');
    } else if (line.startsWith('#')) {
        // Legacy compiled files from earlier builds
        line = line.replace(/^#\s*/, '');
    }
    return line.trim();
}

function parseHeaderSourceHash(headerText) {
    const line = normalizeHeaderText(headerText);
    if (!line || !line.includes(HEADER_MARKER)) {
        return null;
    }
    const lastPipe = line.lastIndexOf(' | ');
    if (lastPipe === -1) {
        return null;
    }
    let token = line.slice(lastPipe + 3).trim();
    if (token.startsWith('Source SHA256:')) {
        token = token.slice('Source SHA256:'.length).trim();
    }
    return token || null;
}

function readFirstLine(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(4096);
        const bytes = fs.readSync(fd, buf, 0, 4096, 0);
        if (bytes === 0) {
            return '';
        }
        const slice = buf.slice(0, bytes);
        const lineEnd = slice.indexOf('\n');
        return lineEnd === -1 ? slice.toString('utf8') : slice.slice(0, lineEnd).toString('utf8');
    } finally {
        fs.closeSync(fd);
    }
}

function readExistingSourceHash(compiledPath) {
    return parseHeaderSourceHash(readFirstLine(compiledPath));
}

function waitForCompileIdle() {
    if (!compileState.inProgress) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const poll = () => {
            if (!compileState.inProgress) {
                resolve();
                return;
            }
            setTimeout(poll, 50);
        };
        poll();
    });
}

function walkManagedFiles(absDir, relPrefix, out) {
    if (!fs.existsSync(absDir)) {
        return;
    }
    const items = fs.readdirSync(absDir);
    for (const item of items) {
        const abs = path.join(absDir, item);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
            walkManagedFiles(abs, `${relPrefix}/${item}`, out);
            continue;
        }
        if (!item.endsWith('.css') && !item.endsWith('.js')) {
            continue;
        }
        const rel = `public${relPrefix}/${item}`.replace(/\\/g, '/');
        out.push({ abs, rel });
    }
}

function scanManagedFiles(projectRoot) {
    const files = [];
    for (const root of MANAGED_ROOTS) {
        walkManagedFiles(path.join(getPublicRoot(projectRoot), root), `/${root}`, files);
    }
    return files;
}

function atomicWrite(filePath, content) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
}

function finalizeStats(stats) {
    stats.bytesSaved = Math.max(0, stats.sourceBytes - stats.outputBytes);
    stats.percentBytesSaved = stats.sourceBytes > 0
        ? Math.round((stats.bytesSaved / stats.sourceBytes) * 1000) / 10
        : 0;
    return stats;
}

function shouldShowInlineConsoleProgress(options = {}) {
    return options.showConsoleProgress !== false && process.stdout.isTTY === true;
}

function renderConsoleProgress(current, total, fileName) {
    const pct = total > 0 ? current / total : 0;
    const filled = Math.min(CONSOLE_PROGRESS_WIDTH, Math.round(pct * CONSOLE_PROGRESS_WIDTH));
    const bar = '='.repeat(Math.max(0, filled - 1)) + (filled > 0 ? '>' : '') + ' '.repeat(Math.max(0, CONSOLE_PROGRESS_WIDTH - filled));
    const label = fileName ? ` ${path.basename(fileName)}` : '';
    process.stdout.write(`\r[Runtime Compile] [${bar}] ${current}/${total} (${Math.round(pct * 100)}%)${label}`);
    if (current >= total && total > 0) {
        process.stdout.write('\n');
    }
}

function emitProgress(current, total, file, stats) {
    const percent = total > 0 ? Math.round((current / total) * 1000) / 10 : 0;
    compileState.progress = { current, total, file, percent };
    if (progressBroadcastCallback) {
        progressBroadcastCallback({
            current,
            total,
            file,
            percent,
            stats: { ...compileState.stats },
            inProgress: compileState.inProgress
        });
    }
}

async function compileCss(source, sourceRelPath, sourceHash, options = {}) {
    validateCssSource(source);

    const runId = options.runId || currentCompileRunId;
    let workingSource = source;
    if (options.dedupeLiterals === true) {
        const deduped = dedupeCssLiterals(source, options.dedupeOptions);
        workingSource = deduped.css;
    }

    const filename = path.basename(sourceRelPath);
    let result;
    try {
        result = transformCss({
            filename,
            code: Buffer.from(workingSource, 'utf8'),
            ...LIGHTNING_CSS_TRANSFORM_OPTIONS
        });
    } catch (err) {
        pushCompileLogEntries([{
            runId,
            timestamp: new Date().toISOString(),
            file: sourceRelPath,
            tool: 'lightningcss',
            type: 'error',
            message: err.message,
            line: null,
            column: null
        }]);
        throw new Error(`CSS minify failed for ${sourceRelPath}: ${err.message}`);
    }

    const logEntries = collectLightningCssLogEntries(result.warnings, sourceRelPath, runId);
    if (logEntries.length > 0) {
        pushCompileLogEntries(logEntries);
    }

    const output = result.code.toString('utf8');
    validateCssBraces(output);

    return `${buildHeader(sourceRelPath, sourceHash)}\n${output}`;
}

async function compileJs(source, sourceRelPath, sourceHash, options = {}) {
    const runId = options.runId || currentCompileRunId;
    const result = await minifyJs(source, {
        compress: {
            warnings: true,
            passes: 2
        },
        mangle: true,
        format: { comments: false }
    });
    if (result.error) {
        pushCompileLogEntries([
            runtimeCompileLogStore.terserErrorToEntry(result.error, sourceRelPath, runId)
        ]);
        throw result.error;
    }
    const code = result.code || '';
    try {
        new Function(code);
    } catch (syntaxErr) {
        pushCompileLogEntries([{
            runId,
            timestamp: new Date().toISOString(),
            file: sourceRelPath,
            tool: 'terser',
            type: 'error',
            message: `Post-minify syntax check failed: ${syntaxErr.message}`,
            line: null,
            column: null
        }]);
        throw syntaxErr;
    }
    return `${buildHeader(sourceRelPath, sourceHash)}\n${code}`;
}

async function compileOneFile(projectRoot, abs, rel, options = {}) {
    const source = fs.readFileSync(abs, 'utf8');
    const sourceHash = hashSource(source);
    const webPath = `/${rel.replace(/^public\//, '')}`;
    const compiledPath = webPathToCompiledPath(projectRoot, webPath);

    if (!options.force) {
        const existingHash = readExistingSourceHash(compiledPath);
        if (existingHash === sourceHash) {
            return { status: 'skipped', rel, webPath, source, sourceHash };
        }
    }

    let output;
    if (abs.endsWith('.css')) {
        output = await compileCss(source, rel, sourceHash, { runId: options.runId });
    } else {
        output = await compileJs(source, rel, sourceHash, { runId: options.runId });
    }

    atomicWrite(compiledPath, output);
    return {
        status: 'compiled',
        rel,
        webPath,
        source,
        output,
        sourceHash
    };
}

function recordCompiledStats(stats, source, output) {
    stats.compiledFiles++;
    stats.sourceBytes += Buffer.byteLength(source, 'utf8');
    stats.outputBytes += Buffer.byteLength(output, 'utf8');
}

async function ensureCompiledForRequest(projectRoot, webPath) {
    if (!isRuntimeManagedWebPath(webPath)) {
        return { changed: false };
    }
    const abs = webPathToSourcePath(projectRoot, webPath);
    if (!fs.existsSync(abs)) {
        return { changed: false };
    }
    const rel = sourcePathToRel(abs, projectRoot);
    try {
        const result = await compileOneFile(projectRoot, abs, rel, { force: false });
        return { changed: result.status === 'compiled', rel: result.rel };
    } catch (err) {
        console.error(`[Runtime Compile] ${rel}: ${err.message}`);
        compileState.errors = compileState.errors.filter((entry) => entry.file !== rel);
        compileState.errors.push({ file: rel, error: err.message });
        return { changed: false, error: err.message, rel };
    }
}

async function compileRuntimeAssets(projectRoot, options = {}) {
    if (compileState.inProgress) {
        if (options.waitIfBusy === false) {
            return { ...getCompileState(), waited: true };
        }
        await waitForCompileIdle();
    }

    compileState.inProgress = true;
    compileState.complete = false;

    const force = options.force === true;
    const showConsoleProgress = shouldShowInlineConsoleProgress(options);
    const errors = [];
    let compiled = 0;
    let skipped = 0;
    const stats = {
        totalFiles: 0,
        compiledFiles: 0,
        sourceBytes: 0,
        outputBytes: 0,
        bytesSaved: 0,
        percentBytesSaved: 0
    };

    const runId = beginCompileRun();

    try {
        const files = scanManagedFiles(projectRoot);
        stats.totalFiles = files.length;
        emitProgress(0, files.length, null, stats);

        let index = 0;
        for (const { abs, rel } of files) {
            index++;
            if (showConsoleProgress) {
                renderConsoleProgress(index, files.length, rel);
            }
            emitProgress(index, files.length, rel, stats);

            try {
                const result = await compileOneFile(projectRoot, abs, rel, { force, runId });
                if (result.status === 'skipped') {
                    skipped++;
                } else {
                    compiled++;
                    recordCompiledStats(stats, result.source, result.output);
                }
            } catch (err) {
                console.error(`[Runtime Compile] ${rel}: ${err.message}`);
                errors.push({ file: rel, error: err.message });
            }
        }

        finalizeStats(stats);

        compileState.complete = true;
        compileState.inProgress = false;
        compileState.lastRunAt = Date.now();
        compileState.compiled = compiled;
        compileState.skipped = skipped;
        compileState.errors = errors;
        compileState.stats = stats;
        compileState.progress = {
            current: files.length,
            total: files.length,
            file: null,
            percent: 100
        };

        emitProgress(files.length, files.length, null, stats);

        return {
            complete: true,
            compiled,
            skipped,
            errors,
            stats,
            lastRunAt: compileState.lastRunAt,
            runId
        };
    } catch (err) {
        compileState.inProgress = false;
        compileState.complete = true;
        compileState.errors = [{ file: '(global)', error: err.message }];
        compileState.lastRunAt = Date.now();
        if (showConsoleProgress) {
            process.stdout.write('\n');
        }
        throw err;
    } finally {
        endCompileRun();
    }
}

function computeCacheStats(projectRoot) {
    const files = scanManagedFiles(projectRoot);
    const stats = {
        totalFiles: files.length,
        compiledFiles: 0,
        sourceBytes: 0,
        outputBytes: 0,
        bytesSaved: 0,
        percentBytesSaved: 0
    };

    for (const { abs } of files) {
        const webPath = `/${sourcePathToRel(abs, projectRoot).replace(/^public\//, '')}`;
        const compiledPath = webPathToCompiledPath(projectRoot, webPath);
        if (!fs.existsSync(compiledPath)) {
            continue;
        }
        const source = fs.readFileSync(abs, 'utf8');
        const output = fs.readFileSync(compiledPath, 'utf8');
        stats.compiledFiles++;
        stats.sourceBytes += Buffer.byteLength(source, 'utf8');
        stats.outputBytes += Buffer.byteLength(output, 'utf8');
    }

    return finalizeStats(stats);
}

function getCompileState(projectRoot) {
    const state = {
        complete: compileState.complete,
        inProgress: compileState.inProgress,
        lastRunAt: compileState.lastRunAt,
        compiled: compileState.compiled,
        skipped: compileState.skipped,
        errors: compileState.errors.slice(),
        progress: { ...compileState.progress },
        stats: { ...compileState.stats }
    };

    if (!compileState.inProgress && projectRoot && state.stats.totalFiles === 0) {
        state.stats = computeCacheStats(projectRoot);
    }

    return state;
}

function isRuntimeManagedWebPath(webPath) {
    if (isManagedWebPath(webPath)) {
        return true;
    }
    return webPath === WORKSPACE_CSS_WEB_PATH;
}

function resolveServedPath(projectRoot, webPath, debugMode) {
    if (webPath === WORKSPACE_CSS_WEB_PATH) {
        const workspaceCssService = require('./workspaceCssService');
        if (debugMode) {
            const sourcePath = workspaceCssService.getSourceCachePath(projectRoot);
            if (fs.existsSync(sourcePath)) {
                return sourcePath;
            }
        }
        const compiledPath = workspaceCssService.resolveServedPath(projectRoot);
        if (compiledPath) {
            return compiledPath;
        }
    }
    if (debugMode || !isManagedWebPath(webPath)) {
        return webPathToSourcePath(projectRoot, webPath);
    }
    const compiled = webPathToCompiledPath(projectRoot, webPath);
    if (fs.existsSync(compiled)) {
        return compiled;
    }
    return webPathToSourcePath(projectRoot, webPath);
}

function isDebugRequest(req) {
    if (req.query && (req.query.sf_debug === '1' || req.query.debug === '1')) {
        return true;
    }
    const header = req.headers['x-staticforge-debug'];
    if (header === '1' || header === 'true') {
        return true;
    }
    const cookie = req.headers.cookie || '';
    return /(?:^|;\s*)staticforge_dev_mode=1(?:;|$)/.test(cookie);
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
    HEADER_MARKER,
    SOURCE_HASH_ALGO,
    MANAGED_ROOTS,
    WORKSPACE_CSS_WEB_PATH,
    OUTPUT_SUBDIR,
    LIGHTNING_CSS_TARGETS,
    LIGHTNING_CSS_TRANSFORM_OPTIONS,
    getOutputRoot,
    getPublicRoot,
    isManagedWebPath,
    isRuntimeManagedWebPath,
    webPathToSourcePath,
    webPathToCompiledPath,
    hashSource,
    parseHeaderSourceHash,
    buildHeader,
    atomicWrite,
    compileCss,
    compileJs,
    compileRuntimeAssets,
    ensureCompiledForRequest,
    getCompileState,
    resolveServedPath,
    isDebugRequest,
    setProgressBroadcastCallback,
    setCompileLogBroadcastCallback,
    initCompileLogStore,
    formatBytes
};
