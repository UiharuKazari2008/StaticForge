/**
 * Merge PM2 stdout/stderr logs chronologically for the log viewer.
 * modules/pm2LogPaths.js (out/err paths)
 * modules/logger.js (readLogFromOffset, formatLogContent)
 */

const fs = require('fs');
const pm2LogPaths = require('./pm2LogPaths');

const PM2_TS_RE = /\[(\d{2})\/(\d{2}), (\d{2}):(\d{2}):(\d{2})\]/;

function isPm2CombinedSource(source) {
    return source === 'pm2:combined';
}

function getPm2PathsOrThrow() {
    const paths = pm2LogPaths.getPm2LogPaths();
    if (!paths) throw new Error('PM2 not available');
    return paths;
}

function parsePm2Timestamp(line) {
    const m = String(line).match(PM2_TS_RE);
    if (!m) return null;
    const year = new Date().getFullYear();
    return new Date(
        year,
        parseInt(m[1], 10) - 1,
        parseInt(m[2], 10),
        parseInt(m[3], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10)
    ).getTime();
}

function annotateLines(text, stream) {
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    if (!normalized) return [];
    const rawLines = normalized.split('\n');
    const lines = rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
    let lastTs = 0;
    let seq = 0;
    return lines.filter((l) => l.length > 0).map((line) => {
        const ts = parsePm2Timestamp(line);
        if (ts !== null) lastTs = ts;
        const order = seq++;
        return { text: line, stream, ts: lastTs || order, order };
    });
}

function mergeAnnotatedLines(...groups) {
    return groups.flat().sort((a, b) => {
        if (a.ts !== b.ts) return a.ts - b.ts;
        if (a.stream !== b.stream) return a.stream === 'out' ? -1 : 1;
        return a.order - b.order;
    });
}

function parseCombinedOffset(raw) {
    if (raw == null || raw === '') return { out: 0, err: 0 };
    if (typeof raw === 'object') {
        return { out: Math.max(0, Number(raw.out) || 0), err: Math.max(0, Number(raw.err) || 0) };
    }
    try {
        const parsed = JSON.parse(decodeURIComponent(String(raw)));
        return { out: Math.max(0, Number(parsed.out) || 0), err: Math.max(0, Number(parsed.err) || 0) };
    } catch (_) {
        return { out: 0, err: 0 };
    }
}

function readFileTailLines(filePath, lineCount, readLogFromOffsetFn) {
    const maxLines = Math.min(Math.max(1, lineCount || 500), 5000);
    try {
        if (!fs.existsSync(filePath)) {
            return { content: '', byteOffset: 0, fileSize: 0, lineCount: 0 };
        }
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
            return { content: '', byteOffset: 0, fileSize: 0, lineCount: 0 };
        }
        const estimateBytes = Math.min(stats.size, maxLines * 256 + 8192);
        const start = stats.size - estimateBytes;
        const buffer = Buffer.allocUnsafe(estimateBytes);
        const fd = fs.openSync(filePath, 'r');
        try {
            fs.readSync(fd, buffer, 0, estimateBytes, start);
        } finally {
            fs.closeSync(fd);
        }
        let text = buffer.toString('utf8');
        const lines = text.split('\n');
        if (start > 0 && lines.length) lines.shift();
        const selected = lines.slice(-maxLines);
        const content = selected.join('\n') + (selected.length ? '\n' : '');
        return { content, byteOffset: stats.size, fileSize: stats.size, lineCount: selected.length };
    } catch (error) {
        throw new Error(`Failed to read log tail: ${error.message}`);
    }
}

function readCombinedTail(lineCount, formatLogContent) {
    const paths = getPm2PathsOrThrow();
    const fetchLines = Math.min(Math.max(lineCount * 2, lineCount), 5000);
    const outTail = readFileTailLines(paths.out, fetchLines);
    const errTail = readFileTailLines(paths.err, fetchLines);
    const merged = mergeAnnotatedLines(
        annotateLines(outTail.content, 'out'),
        annotateLines(errTail.content, 'err')
    ).slice(-lineCount);

    const outStats = fs.existsSync(paths.out) ? fs.statSync(paths.out) : { size: 0 };
    const errStats = fs.existsSync(paths.err) ? fs.statSync(paths.err) : { size: 0 };
    const content = merged.map((l) => l.text).join('\n') + (merged.length ? '\n' : '');

    return {
        content: formatLogContent(content, 'pm2:combined'),
        byteOffset: { out: outStats.size, err: errStats.size },
        fileSize: outStats.size + errStats.size,
        lineCount: merged.length
    };
}

function splitWithPartial(text, partial) {
    const combined = (partial || '') + String(text || '');
    const parts = combined.split('\n');
    const remainder = parts.pop() || '';
    return { lines: parts.filter((l) => l.length > 0), partial: remainder };
}

function readCombinedChunk(state, maxBytes, readLogFromOffsetFn, formatLogContent) {
    const paths = getPm2PathsOrThrow();
    const half = Math.max(512, Math.floor(maxBytes / 2));
    const outChunk = readLogFromOffsetFn(paths.out, state.offsets.out, half);
    const errChunk = readLogFromOffsetFn(paths.err, state.offsets.err, half);

    const outSplit = splitWithPartial(outChunk.content, state.partial.out);
    const errSplit = splitWithPartial(errChunk.content, state.partial.err);
    state.partial.out = outSplit.partial;
    state.partial.err = errSplit.partial;

    const annotated = mergeAnnotatedLines(
        annotateLines(outSplit.lines.join('\n') + (outSplit.lines.length ? '\n' : ''), 'out'),
        annotateLines(errSplit.lines.join('\n') + (errSplit.lines.length ? '\n' : ''), 'err')
    );

    const content = annotated.map((l) => l.text).join('\n') + (annotated.length ? '\n' : '');
    const nextOffset = { out: outChunk.nextOffset, err: errChunk.nextOffset };
    state.offsets = { ...nextOffset };

    return {
        content: content ? formatLogContent(content, 'pm2:combined') : '',
        nextOffset,
        fileSize: (outChunk.fileSize || 0) + (errChunk.fileSize || 0),
        rotated: outChunk.rotated || errChunk.rotated
    };
}

function createCombinedStreamState(startOffset) {
    const offsets = parseCombinedOffset(startOffset);
    return {
        offsets,
        partial: { out: '', err: '' },
        lastInodes: { out: null, err: null }
    };
}

function pollCombinedRotation(paths, state) {
    const fs = require('fs');
    let rotated = false;
    for (const key of ['out', 'err']) {
        const filePath = paths[key];
        if (!fs.existsSync(filePath)) {
            if (state.offsets[key] !== 0) rotated = true;
            state.offsets[key] = 0;
            state.partial[key] = '';
            state.lastInodes[key] = null;
            continue;
        }
        const stats = fs.statSync(filePath);
        const inode = stats.ino;
        if (state.lastInodes[key] !== null && (stats.size < state.offsets[key] || inode !== state.lastInodes[key])) {
            rotated = true;
            state.offsets[key] = 0;
            state.partial[key] = '';
        }
        state.lastInodes[key] = inode;
    }
    return rotated;
}

module.exports = {
    isPm2CombinedSource,
    parseCombinedOffset,
    readCombinedTail,
    readCombinedChunk,
    createCombinedStreamState,
    pollCombinedRotation,
    getPm2PathsOrThrow
};
