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

// JULES: mem-leak tracing-bounds

const MAX_OPEN_TRACES = 200;
const OPEN_TRACE_TTL_MS = 30 * 60 * 1000;
const TRACES_DIR_MAX_FILES = 2000;
const TRACES_DIR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [id, trace] of openTraces.entries()) {
        if (now - trace.startedAt > OPEN_TRACE_TTL_MS) {
            openTraces.delete(id);
        }
    }
    // Cap size
    if (openTraces.size > MAX_OPEN_TRACES) {
        const sorted = Array.from(openTraces.entries()).sort((a, b) => a[1].startedAt - b[1].startedAt);
        const toDelete = sorted.slice(0, openTraces.size - MAX_OPEN_TRACES);
        for (const [id] of toDelete) {
            openTraces.delete(id);
        }
    }
}, 15 * 60 * 1000).unref();

setInterval(() => {
    try {
        if (!fs.existsSync(tracesDir)) return;
        let files = fs.readdirSync(tracesDir).filter(f => f.endsWith('.json'));
        if (files.length === 0) return;

        const now = Date.now();
        const fileStats = [];
        for (const f of files) {
            try {
                const fullPath = path.join(tracesDir, f);
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > TRACES_DIR_TTL_MS) {
                    fs.unlinkSync(fullPath);
                } else {
                    fileStats.push({ path: fullPath, mtimeMs: stat.mtimeMs });
                }
            } catch (err) {}
        }

        if (fileStats.length > TRACES_DIR_MAX_FILES) {
            fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
            const toDelete = fileStats.slice(0, fileStats.length - TRACES_DIR_MAX_FILES);
            for (const f of toDelete) {
                try {
                    fs.unlinkSync(f.path);
                } catch (err) {}
            }
        }
    } catch (e) {}
}, 12 * 60 * 60 * 1000).unref();



function getTraceFilePath(traceId) {
    return path.join(tracesDir, `${traceId}.json`);
}

function safeId(input) {
    return String(input || 'req').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 120);
}

function startTrace(requestId, context = {}) {
    const id = safeId(requestId || `trace-${Date.now()}`);
    const trace = {
        id,
        startedAt: Date.now(),
        status: 'running',
        context,
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
    trace.events.push({
        type: event.type || 'event',
        timestamp: Date.now(),
        ...event
    });
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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}_${safeId(label)}.${extension}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    return { filename, relPath: `${id}/${filename}` };
}

function addImageAttachment(requestId, label, buffer, extension = 'png', meta = {}) {
    const id = safeId(requestId);
    const trace = openTraces.get(id) || loadTrace(id);
    if (!trace) return;
    const saved = saveAttachmentBuffer(id, buffer, extension, label);
    if (!saved) return;
    const attachment = { type: 'image', label, path: saved.relPath, ...meta, timestamp: Date.now() };
    trace.attachments.push(attachment);
    trace.events.push({ type: 'image_generated', label, path: saved.relPath, ...meta, timestamp: Date.now() });
    persistTrace(trace);
}

function finalizeTrace(requestId, status = 'completed', meta = {}) {
    const id = safeId(requestId);
    const trace = openTraces.get(id) || loadTrace(id);
    if (!trace) return;
    trace.status = status;
    trace.endedAt = Date.now();
    trace.meta = { ...(trace.meta || {}), ...meta };
    persistTrace(trace);
    openTraces.delete(id);
}


// JULES: mem-leak tracing-bounds (throttle persistTrace)
const persistTimeouts = new Map();

function persistTrace(trace) {
    if (!trace || !trace.id) return;

    // If it's a finalization or initial creation, persist immediately and clear timeout
    if (trace.status !== 'running' || trace.events.length === 0) {
        if (persistTimeouts.has(trace.id)) {
            clearTimeout(persistTimeouts.get(trace.id));
            persistTimeouts.delete(trace.id);
        }
        _doPersistTrace(trace);
        return;
    }

    // Otherwise throttle to max 1 write per second per trace
    if (persistTimeouts.has(trace.id)) return;

    persistTimeouts.set(trace.id, setTimeout(() => {
        persistTimeouts.delete(trace.id);
        _doPersistTrace(trace);
    }, 1000).unref());
}

function _doPersistTrace(trace) {
    const filePath = getTraceFilePath(trace.id);
    try {
        fs.writeFileSync(filePath, JSON.stringify(trace, null, 2));
    } catch (e) {
        // Best-effort; keep in memory
    }
}

function loadTrace(id) {
    const filePath = getTraceFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data;
    } catch (e) {
        return null;
    }
}

function listTraces() {
    if (!fs.existsSync(tracesDir)) {
        console.log('⚠️ Traces directory does not exist:', tracesDir);
        return [];
    }
    
    let files;
    try {
        files = fs.readdirSync(tracesDir).filter(f => f.endsWith('.json'));
        console.log(`📁 Found ${files.length} trace files in ${tracesDir}`);
    } catch (e) {
        console.error('❌ Error reading traces directory:', e);
        return [];
    }
    
    // JULES: mem-leak tracing-bounds (cap to 500 files to avoid memory exhaustion)
    if (files.length > 500) {
        try {
            const fileStats = files.map(f => {
                const fullPath = path.join(tracesDir, f);
                return { f, mtimeMs: fs.statSync(fullPath).mtimeMs };
            });
            fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
            files = fileStats.slice(0, 500).map(s => s.f);
        } catch (e) {
            files = files.slice(0, 500);
        }
    }

    const fromFiles = files.map(f => {
        try {
            const filePath = path.join(tracesDir, f);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(fileContent);
            if (!data.id || !data.startedAt) {
                console.warn(`⚠️ Invalid trace file structure in ${f}: missing id or startedAt`);
                return null;
            }
            return {
                id: data.id,
                startedAt: data.startedAt,
                endedAt: data.endedAt || null,
                status: data.status || 'unknown',
                summary: data.meta?.summary || null
            };
        } catch (e) {
            console.error(`❌ Error reading trace file ${f}:`, e.message);
            return null;
        }
    }).filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    
    console.log(`📊 Successfully parsed ${fromFiles.length} traces from ${files.length} files`);

    // Include any open traces not yet written to disk
    const fromMemory = Array.from(openTraces.values()).map(t => ({
        id: t.id,
        startedAt: t.startedAt,
        endedAt: t.endedAt || null,
        status: t.status || 'running',
        summary: t.meta?.summary || null
    }));

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
    tracesDir
};


