/**
 * Persists CSS (Lightning) and JS (Terser) minifier diagnostics from runtime compile runs.
 * modules/logger.js (log directory)
 */

const fs = require('fs');
const path = require('path');

const LOG_FILENAME = 'runtime-minify.log';
const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let logsDir = null;
let broadcastCallback = null;
let entryBuffer = [];

function init(options = {}) {
    logsDir = options.logsDir || null;
    broadcastCallback = typeof options.broadcast === 'function' ? options.broadcast : null;
}

function getLogPath() {
    if (!logsDir) return null;
    return path.join(logsDir, LOG_FILENAME);
}

function formatLogLine(entry) {
    const ts = entry.timestamp || new Date().toISOString();
    const loc = entry.line != null
        ? `:${entry.line}${entry.column != null ? `:${entry.column}` : ''}`
        : '';
    const tool = entry.tool || 'unknown';
    const type = entry.type || 'info';
    const file = entry.file || '(unknown)';
    const runId = entry.runId || '-';
    return `[${ts}] [${runId}] [${tool}] [${type}] ${file}${loc} — ${entry.message}`;
}

function pruneLogFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
        const stats = fs.statSync(filePath);
        if (stats.size < 512 * 1024) return;

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const cutoff = Date.now() - MAX_AGE_MS;
        const kept = [];

        for (const line of lines) {
            const m = line.match(/^\[([^\]]+)\]/);
            if (!m) {
                kept.push(line);
                continue;
            }
            const ts = Date.parse(m[1]);
            if (!Number.isNaN(ts) && ts < cutoff) continue;
            kept.push(line);
        }

        const trimmed = kept.length > MAX_ENTRIES ? kept.slice(-MAX_ENTRIES) : kept;
        fs.writeFileSync(filePath, `${trimmed.join('\n')}\n`, 'utf8');
    } catch (err) {
        console.warn('[RuntimeCompileLog] prune failed:', err.message);
    }
}

function appendEntries(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0) return;

    const filePath = getLogPath();
    const normalized = entries.map((entry) => ({
        runId: entry.runId,
        timestamp: entry.timestamp || new Date().toISOString(),
        file: entry.file,
        tool: entry.tool,
        type: entry.type || 'warning',
        message: entry.message,
        line: entry.line != null ? entry.line : null,
        column: entry.column != null ? entry.column : null
    }));

    entryBuffer.push(...normalized);
    if (entryBuffer.length > MAX_ENTRIES) {
        entryBuffer = entryBuffer.slice(-MAX_ENTRIES);
    }

    if (filePath) {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const text = `${normalized.map(formatLogLine).join('\n')}\n`;
            fs.appendFileSync(filePath, text, 'utf8');
            pruneLogFile(filePath);
        } catch (err) {
            console.warn('[RuntimeCompileLog] write failed:', err.message);
        }
    }

    if (options.broadcast !== false && broadcastCallback) {
        try {
            broadcastCallback({
                entries: normalized,
                runId: normalized[0] && normalized[0].runId,
                timestamp: Date.now()
            });
        } catch (err) {
            console.warn('[RuntimeCompileLog] broadcast failed:', err.message);
        }
    }
}

function createRunId() {
    return `rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lightningWarningToEntry(warning, file, runId) {
    return {
        runId,
        timestamp: new Date().toISOString(),
        file,
        tool: 'lightningcss',
        type: warning.type || 'warning',
        message: warning.message || String(warning),
        line: warning.loc && warning.loc.line != null ? warning.loc.line : null,
        column: warning.loc && warning.loc.column != null ? warning.loc.column : null
    };
}

function terserErrorToEntry(error, file, runId) {
    return {
        runId,
        timestamp: new Date().toISOString(),
        file,
        tool: 'terser',
        type: 'error',
        message: error.message || String(error),
        line: error.line != null ? error.line : null,
        column: error.col != null ? error.col : null
    };
}

function getRecentEntries(limit = 200) {
    const max = Math.min(Math.max(1, limit), MAX_ENTRIES);
    const filePath = getLogPath();
    if (filePath && fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            return lines.slice(-max);
        } catch (_) { /* fall through */ }
    }
    return entryBuffer.slice(-max).map(formatLogLine);
}

module.exports = {
    LOG_FILENAME,
    init,
    getLogPath,
    formatLogLine,
    appendEntries,
    createRunId,
    lightningWarningToEntry,
    terserErrorToEntry,
    getRecentEntries
};
