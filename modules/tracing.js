const fs = require('fs');
const path = require('path');

// Tracing storage lives under .cache/traces by default
const cacheDir = path.resolve(__dirname, '..', '.cache');
const tracesDir = path.join(cacheDir, 'traces');

if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
}

// In-memory index of open traces to reduce disk churn during a request
const openTraces = new Map(); // requestId -> { id, startedAt, status, events: [], context: {}, attachments: [] }

// Coalesced async writes: id -> { trace, timer, writing, dirty, waiters }
// A trace that is finalized but still being written stays here so loadTrace
// and late addEvent calls see the newest copy instead of a stale file.
const pendingWrites = new Map();
const PERSIST_DEBOUNCE_MS = 250;

// Summary index for listTraces: filename -> summary (or null when the file is invalid).
// Built once from disk, then kept fresh by persistTrace and a cheap readdir per list.
const summaryIndex = new Map();
let indexRefresh = null;

// Large base64 blobs (input images, masks) are replaced by a length marker before tracing.
const BASE64_MIN_LENGTH = 4096;
const BASE64_RE = /^(data:[^;,]+;base64,)?[A-Za-z0-9+/\r\n]+={0,2}$/;

function sanitizeTraceValue(value, seen = new Set()) {
    if (typeof value === 'string') {
        if (value.length >= BASE64_MIN_LENGTH && BASE64_RE.test(value)) {
            const prefix = value.startsWith('data:') ? value.slice(0, value.indexOf(',') + 1) : '';
            return `[base64 omitted: ${value.length} chars${prefix ? `, ${prefix}` : ''}]`;
        }
        return value;
    }
    if (!value || typeof value !== 'object') return value;
    if (Buffer.isBuffer(value)) return `[buffer omitted: ${value.length} bytes]`;
    if (ArrayBuffer.isView(value)) return `[binary omitted: ${value.byteLength} bytes]`;
    if (typeof value.toJSON === 'function') return sanitizeTraceValue(value.toJSON(), seen);
    if (seen.has(value)) return undefined;
    seen.add(value);
    let out;
    if (Array.isArray(value)) {
        out = value.map(v => {
            const s = sanitizeTraceValue(v, seen);
            return (s === undefined || typeof s === 'function' || typeof s === 'symbol') ? null : s;
        });
    } else {
        out = {};
        for (const key of Object.keys(value)) {
            const s = sanitizeTraceValue(value[key], seen);
            if (s !== undefined && typeof s !== 'function' && typeof s !== 'symbol') out[key] = s;
        }
    }
    seen.delete(value);
    return out;
}

setInterval(() => {
    const now = Date.now();
    const ttl = 2 * 60 * 60 * 1000;
    for (const [id, trace] of openTraces.entries()) {
        if (now - trace.startedAt > ttl) {
            if (trace.status === 'running') {
                trace.status = 'timeout';
                trace.endedAt = now;
                try { persistTrace(trace, { immediate: true }); } catch(e) {}
            }
            openTraces.delete(id);
        }
    }
    if (openTraces.size > 200) {
        const sorted = Array.from(openTraces.values()).sort((a, b) => a.startedAt - b.startedAt);
        for (let i = 0; i < sorted.length - 100; i++) {
            openTraces.delete(sorted[i].id);
        }
    }
}, 15 * 60 * 1000).unref?.();

function getTraceFilePath(traceId) {
    return path.join(tracesDir, `${traceId}.json`);
}

function safeId(input) {
    return String(input || 'req').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 120);
}

function summarize(data, fallbackStatus) {
    return {
        id: data.id,
        startedAt: data.startedAt,
        endedAt: data.endedAt || null,
        status: data.status || fallbackStatus,
        summary: data.meta?.summary || null
    };
}

function startTrace(requestId, context = {}) {
    const id = safeId(requestId || `trace-${Date.now()}`);
    const trace = {
        id,
        startedAt: Date.now(),
        status: 'running',
        context: sanitizeTraceValue(context),
        events: [],
        attachments: []
    };
    openTraces.set(id, trace);
    persistTrace(trace);
    return id;
}

function addEvent(requestId, event) {
    const id = safeId(requestId);
    const trace = openTraces.get(id) || loadTrace(id);
    if (!trace) return;
    trace.events.push(sanitizeTraceValue({
        type: event.type || 'event',
        timestamp: Date.now(),
        ...event
    }));
    persistTrace(trace);
}

function addAIMessage(requestId, role, content, extras = {}) {
    addEvent(requestId, {
        type: 'ai_message',
        role,
        content,
        ...extras
    });
}

function saveAttachmentBuffer(requestId, buffer, extension = 'png', label = 'attachment') {
    const id = safeId(requestId);
    if (!buffer) return null;
    const dir = path.join(tracesDir, id);
    const filename = `${Date.now()}_${safeId(label)}.${extension}`;
    const filePath = path.join(dir, filename);
    // Written in the background; the trace only records the relative path.
    fs.promises.mkdir(dir, { recursive: true })
        .then(() => fs.promises.writeFile(filePath, buffer))
        .catch(() => {});
    return { filename, relPath: `${id}/${filename}` };
}

function addImageAttachment(requestId, label, buffer, extension = 'png', meta = {}) {
    const id = safeId(requestId);
    const trace = openTraces.get(id) || loadTrace(id);
    if (!trace) return;
    const saved = saveAttachmentBuffer(id, buffer, extension, label);
    if (!saved) return;
    const cleanMeta = sanitizeTraceValue(meta) || {};
    const attachment = { type: 'image', label, path: saved.relPath, ...cleanMeta, timestamp: Date.now() };
    trace.attachments.push(attachment);
    trace.events.push({ type: 'image_generated', label, path: saved.relPath, ...cleanMeta, timestamp: Date.now() });
    persistTrace(trace);
}

function finalizeTrace(requestId, status = 'completed', meta = {}) {
    const id = safeId(requestId);
    const trace = openTraces.get(id) || loadTrace(id);
    if (!trace) return;
    trace.status = status;
    trace.endedAt = Date.now();
    trace.meta = { ...(trace.meta || {}), ...sanitizeTraceValue(meta) };
    persistTrace(trace, { immediate: true });
    openTraces.delete(id);
}

async function writeTraceFile(trace) {
    const filePath = getTraceFilePath(trace.id);
    // Not *.json, so listTraces and cache expiry never pick up a half-written file.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(trace));
    await fs.promises.rename(tmpPath, filePath);
}

function runPendingWrite(entry) {
    entry.timer = null;
    if (entry.writing) {
        entry.dirty = true;
        return;
    }
    entry.writing = true;
    entry.dirty = false;
    writeTraceFile(entry.trace).catch(() => {
        // Best-effort; keep in memory
    }).then(() => {
        entry.writing = false;
        if (entry.dirty) {
            runPendingWrite(entry);
            return;
        }
        if (entry.timer) return;
        if (pendingWrites.get(entry.trace.id) === entry) pendingWrites.delete(entry.trace.id);
        const waiters = entry.waiters;
        entry.waiters = [];
        waiters.forEach(fn => fn());
    });
}

/**
 * Queue a write of the whole trace. Writes are compact JSON, debounced, with at
 * most one in flight per trace; immediate skips the debounce (finalize).
 */
function persistTrace(trace, { immediate = false } = {}) {
    if (!trace || !trace.id) return;
    summaryIndex.set(`${trace.id}.json`, summarize(trace, 'unknown'));
    let entry = pendingWrites.get(trace.id);
    if (!entry) {
        entry = { trace, timer: null, writing: false, dirty: false, waiters: [] };
        pendingWrites.set(trace.id, entry);
    }
    entry.trace = trace;
    if (immediate) {
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
        runPendingWrite(entry);
        return;
    }
    if (entry.writing) {
        entry.dirty = true;
        return;
    }
    if (!entry.timer) {
        entry.timer = setTimeout(() => runPendingWrite(entry), PERSIST_DEBOUNCE_MS);
    }
}

/** Resolve once every queued trace write has reached disk (tests, shutdown). */
function flushTraces() {
    const waits = [];
    for (const entry of Array.from(pendingWrites.values())) {
        waits.push(new Promise(resolve => entry.waiters.push(resolve)));
        if (entry.timer) { clearTimeout(entry.timer); runPendingWrite(entry); }
    }
    return Promise.all(waits).then(() => undefined);
}

function loadTrace(id) {
    const live = openTraces.get(id) || pendingWrites.get(id)?.trace;
    if (live) return live;
    const filePath = getTraceFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data;
    } catch (e) {
        return null;
    }
}

async function readSummaryFromFile(f) {
    try {
        const filePath = path.join(tracesDir, f);
        const fileContent = await fs.promises.readFile(filePath, 'utf8');
        const data = JSON.parse(fileContent);
        if (!data.id || !data.startedAt) {
            console.warn(`⚠️ Invalid trace file structure in ${f}: missing id or startedAt`);
            return null;
        }
        return summarize(data, 'unknown');
    } catch (e) {
        console.error(`❌ Error reading trace file ${f}:`, e.message);
        return null;
    }
}

/**
 * Sync the summary index with the directory: drop entries whose file is gone
 * (cache expiry), parse files not seen yet. Only the first call parses everything.
 */
async function refreshSummaryIndex() {
    let files;
    try {
        files = (await fs.promises.readdir(tracesDir)).filter(f => f.endsWith('.json'));
        console.log(`📁 Found ${files.length} trace files in ${tracesDir}`);
    } catch (e) {
        if (e && e.code === 'ENOENT') {
            console.log('⚠️ Traces directory does not exist:', tracesDir);
        } else {
            console.error('❌ Error reading traces directory:', e);
        }
        return null;
    }
    const present = new Set(files);
    for (const key of Array.from(summaryIndex.keys())) {
        if (!present.has(key) && !pendingWrites.has(key.slice(0, -5))) summaryIndex.delete(key);
    }
    const missing = files.filter(f => !summaryIndex.has(f));
    const CONCURRENCY = 8;
    let next = 0;
    async function worker() {
        while (next < missing.length) {
            const f = missing[next++];
            const summary = await readSummaryFromFile(f);
            // A persistTrace during the read already holds a fresher summary.
            if (!summaryIndex.has(f)) summaryIndex.set(f, summary);
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
    return files;
}

async function listTraces() {
    if (!indexRefresh) {
        indexRefresh = refreshSummaryIndex().finally(() => { indexRefresh = null; });
    }
    const files = await indexRefresh;
    if (!files) return [];

    const fromFiles = [];
    for (const f of files) {
        const s = summaryIndex.get(f);
        if (s) fromFiles.push({ ...s });
    }
    fromFiles.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

    console.log(`📊 Successfully parsed ${fromFiles.length} traces from ${files.length} files`);

    // Include any open traces (and finalized ones whose write is queued) not yet on disk
    const fromMemory = [
        ...Array.from(pendingWrites.values()).map(e => e.trace).filter(t => !openTraces.has(t.id)),
        ...Array.from(openTraces.values())
    ].map(t => summarize(t, 'running'));

    // Merge unique by id
    const map = new Map();
    [...fromFiles, ...fromMemory].forEach(item => { if (item) map.set(item.id, item); });
    return Array.from(map.values()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

module.exports = {
    startTrace,
    addEvent,
    addAIMessage,
    addImageAttachment,
    finalizeTrace,
    listTraces,
    loadTrace,
    flushTraces,
    sanitizeTraceValue,
    tracesDir
};
