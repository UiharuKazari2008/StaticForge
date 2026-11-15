'use strict';

/**
 * Print spooler view of the generation backends (Yozora #831 slice 8).
 *
 * The desktop shows generations as Vista printing: a printer tray icon while documents are
 * pending, one print queue window per printer, and the Print Management console. Printers are
 * the generation backends, documents are their jobs:
 *
 *   NovelAI                the global generation FIFO (modules/generationJobQueue.js): Studio
 *                          prints, rerolls, presets and MCP generate_image / generate_preset
 *   <local worker>         each configured local worker (Ruiko, G10; modules/localUpscaleWorker.js):
 *                          upscale and animate jobs, registered here by beginLocalJob / endLocalJob
 *
 * State goes to the clients as a push, never a poll (no-client-polling): every FIFO change and
 * local job change schedules one `print_queue_state` broadcast (coalesced, 200 ms) to signed-in
 * admin clients. A client reads it once with `print_queue_get` (on connect) and keeps it from the
 * pushes. Packets: modules/ws/handlers/printQueueHandler.js.
 *
 * Nothing here copies a worker URL path, key or token: printers carry a host name only.
 */

const crypto = require('crypto');

const PUSH_DELAY_MS = 200;
const RECENT_LIMIT = 30;
const LOCAL_RECENT_TTL_MS = 30 * 60 * 1000;
const NAI_PRINTER_ID = 'novelai';

// NovelAI resolution presets (Studio's names) -> pixels, for the page size and spool size
const RESOLUTION_PRESETS = {
    small_portrait: [512, 768], small_landscape: [768, 512], small_square: [640, 640],
    normal_portrait: [832, 1216], normal_landscape: [1216, 832], normal_square: [1024, 1024],
    large_portrait: [1024, 1536], large_landscape: [1536, 1024], large_square: [1472, 1472],
    wallpaper_portrait: [1088, 1920], wallpaper_landscape: [1920, 1088]
};

const localJobs = new Map();     // spool id -> local job (active)
const localRecent = [];          // finished local jobs, newest last
let boundResources = null;
let unsubscribeQueue = null;
let pushTimer = null;
let workerHealth = null;         // last checkLocalWorkerHealth result (rows by worker id)
let workerHealthAt = 0;

function clip(value, max) {
    const text = String(value == null ? '' : value).replace(/[\r\n\t\0]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** A short one-way tag for a session, so a client can tell its own documents without seeing ids. */
function sessionTag(sessionId) {
    if (!sessionId) return null;
    return crypto.createHash('sha256').update(`print-owner:${sessionId}`).digest('hex').slice(0, 16);
}

function parseSize(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const w = Number(p.width);
    const h = Number(p.height);
    if (w > 0 && h > 0) return [Math.round(w), Math.round(h)];
    const res = String(p.resolution || p.size || '').trim().toLowerCase();
    const m = res.match(/^(\d{2,5})\s*[x*]\s*(\d{2,5})$/);
    if (m) return [Number(m[1]), Number(m[2])];
    if (RESOLUTION_PRESETS[res]) return RESOLUTION_PRESETS[res].slice();
    return [0, 0];
}

function parsePages(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const keys = ['n', 'n_samples', 'nSamples', 'samples', 'batch', 'batchSize', 'count'];
    for (const key of keys) {
        const n = Math.floor(Number(p[key]));
        if (Number.isFinite(n) && n > 0) return Math.min(n, 99);
    }
    return 1;
}

/**
 * The document a generation request prints as: { name, pages, width, height }.
 * name: the prompt's start (Studio, generate_image), the preset (generate_preset) or the
 * source file (reroll_image).
 */
function describeDocument(type, payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const [width, height] = parseSize(p);
    let name = '';
    if (type === 'reroll_image') name = p.filename ? `Reroll - ${p.filename}` : 'Reroll';
    else if (type === 'generate_preset') name = p.presetName || p.preset || p.name || '';
    if (!name) name = p.prompt || p.input || p.title || '';
    if (!name && p.preset) name = p.preset;
    return {
        name: clip(name || 'Untitled', 120),
        pages: parsePages(p),
        width,
        height
    };
}

/** Owner of a Studio (WS) document: Melaton Mobile for a phone socket, else Studio. */
function ownerFromClient(clientInfo) {
    const ua = String((clientInfo && (clientInfo.userAgent || clientInfo.applicationUserAgent)) || '');
    return /android|iphone|mobile|dsapp/i.test(ua) ? 'Melaton Mobile' : 'Studio';
}

/** Owner of an MCP document: the agent's name without its key id ("Wren/appkey:abc" -> "Wren"). */
function ownerFromCaller(caller) {
    const text = String(caller || '').trim();
    if (!text) return 'Remote Access';
    if (/^session:/.test(text)) return 'Studio';
    if (/^appkey:/.test(text)) return 'Remote Access';
    return clip(text.replace(/\/appkey:.*$/, ''), 60) || 'Remote Access';
}

function hostOf(url) {
    try { return new URL(String(url || '')).host || ''; } catch (_err) { return ''; }
}

function sharedQueue(globalResources) {
    try {
        if (globalResources && typeof globalResources.getGenerationJobQueue === 'function') {
            return globalResources.getGenerationJobQueue();
        }
    } catch (_err) { /* below */ }
    try {
        return require('./generationJobQueue').getSharedGenerationJobQueue();
    } catch (_err) {
        return null;
    }
}

function readWorkers(globalResources) {
    try {
        const luw = require('./localUpscaleWorker');
        return luw.readLocalWorkers(globalResources).map((worker) => ({
            id: worker.id,
            name: luw.workerDisplayName(worker),
            host: hostOf(worker.url),
            animate: worker.animate === true
        }));
    } catch (_err) {
        return [];
    }
}

function spoolBytes(doc) {
    if (!doc) return 0;
    const w = Number(doc.width) || 0;
    const h = Number(doc.height) || 0;
    if (!w || !h) return 0;
    return w * h * 3 * (Number(doc.pages) || 1);
}

// ---- local worker jobs (upscale, animate) ---------------------------------------------------------

/**
 * A local worker job enters the queue: { kind: 'upscale'|'animate', workerId, workerJobId, name,
 * pages, size, owner }. Returns the spool id for updateLocalJob / endLocalJob.
 */
function beginLocalJob(info) {
    const src = info && typeof info === 'object' ? info : {};
    const id = `ljob_${crypto.randomBytes(6).toString('hex')}`;
    localJobs.set(id, {
        id,
        kind: src.kind === 'animate' ? 'animate' : 'upscale',
        printer: `local:${src.workerId || 'worker'}`,
        workerJobId: src.workerJobId ? String(src.workerJobId) : null,
        name: clip(src.name || (src.kind === 'animate' ? 'Animate' : 'Upscale'), 120),
        pages: Math.max(1, Math.floor(Number(src.pages) || 1)),
        size: Math.max(0, Math.floor(Number(src.size) || 0)),
        owner: clip(src.owner || 'Studio', 60),
        status: 'queued',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        error: null
    });
    schedulePush();
    return id;
}

/** The worker reported a status ('queued' / 'running' / ...): only a change pushes. */
function updateLocalJob(id, status) {
    const job = localJobs.get(String(id || ''));
    if (!job) return;
    const next = status === 'queued' || status === 'pending' ? 'queued' : 'running';
    if (job.status === next) return;
    job.status = next;
    if (next === 'running' && !job.startedAt) job.startedAt = Date.now();
    schedulePush();
}

function endLocalJob(id, err) {
    const key = String(id || '');
    const job = localJobs.get(key);
    if (!job) return;
    localJobs.delete(key);
    job.status = err ? 'failed' : 'completed';
    job.error = err ? clip((err && err.message) || err, 200) : null;
    job.finishedAt = Date.now();
    localRecent.push(job);
    const cutoff = Date.now() - LOCAL_RECENT_TTL_MS;
    while (localRecent.length && (localRecent.length > RECENT_LIMIT || localRecent[0].finishedAt < cutoff)) {
        localRecent.shift();
    }
    schedulePush();
}

// ---- the state ------------------------------------------------------------------------------------

const VISTA_STATUS = {
    queued: '',
    delayed: 'Spooling',
    running: 'Printing',
    completed: 'Printed',
    failed: 'Error',
    cancelled: 'Deleting'
};

function fifoOutcomeError(job) {
    const result = job.result && typeof job.result === 'object' ? job.result : {};
    const flat = result.flat && typeof result.flat === 'object' ? result.flat : {};
    return flat.error || result.error || 'generation failed';
}

function publicFifoJob(job) {
    const doc = job.document || {};
    // the WS work functions report their own errors and resolve { success: false }
    const failedOutcome = job.status === 'completed' && job.success === false;
    const status = failedOutcome ? 'failed' : job.status;
    const statusKey = job.cancelRequested && status === 'running' ? 'cancelled' : status;
    const cancellable = job.status === 'queued' || job.status === 'delayed'
        || (job.status === 'running' && job.source === 'ws' && !!job.requestId && !job.cancelRequested);
    return {
        id: job.jobId || job.id,
        printer: NAI_PRINTER_ID,
        type: job.type,
        name: doc.name || 'Untitled',
        status,
        statusText: VISTA_STATUS[statusKey] != null ? VISTA_STATUS[statusKey] : '',
        owner: job.owner || ownerFromCaller(job.caller),
        self: job.caller && /^session:/.test(job.caller) ? sessionTag(job.caller.slice(8)) : null,
        pages: Number(doc.pages) || 1,
        size: spoolBytes(doc),
        width: Number(doc.width) || 0,
        height: Number(doc.height) || 0,
        submitted: job.createdAt || null,
        started: job.startedAt || null,
        finished: job.finishedAt || null,
        workspace: job.workspace || null,
        cancellable,
        error: job.status === 'failed' ? clip((job.error && job.error.message) || job.error || 'generation failed', 200)
            : (failedOutcome ? clip(fifoOutcomeError(job), 200) : null)
    };
}

function publicLocalJob(job) {
    return {
        id: job.id,
        printer: job.printer,
        type: job.kind,
        name: job.name,
        status: job.status,
        statusText: VISTA_STATUS[job.status] != null ? VISTA_STATUS[job.status] : '',
        owner: job.owner,
        self: null,
        pages: job.pages,
        size: job.size,
        width: 0,
        height: 0,
        submitted: job.createdAt,
        started: job.startedAt,
        finished: job.finishedAt,
        workspace: null,
        cancellable: false,
        error: job.error
    };
}

function liveFifoJobs(queue) {
    if (!queue || typeof queue.get !== 'function' || typeof queue.listPublic !== 'function') return [];
    // listPublic drops owner/document/cancelRequested on older queues: read the job itself
    return queue.listPublic().map((snap) => {
        const job = queue.get(snap.jobId);
        return job ? { ...snap, owner: job.owner || null, document: job.document || null, cancelRequested: !!job.cancelRequested, source: job.source, requestId: job.requestId, error: job.error, result: job.result } : null;
    }).filter(Boolean);
}

function workerRow(worker) {
    const rows = (workerHealth && workerHealth.workers) || [];
    const live = rows.find((row) => row && row.id === worker.id);
    if (!workerHealthAt) return { known: false, online: true };
    return { known: true, online: !!(live && live.online) };
}

/** The whole print state: printers, active documents, recently finished documents. */
function buildState(globalResources) {
    const gr = globalResources || boundResources;
    const queue = sharedQueue(gr);
    const fifo = liveFifoJobs(queue);
    const active = [];
    const recent = [];
    fifo.forEach((job) => {
        const row = publicFifoJob(job);
        if (job.status === 'queued' || job.status === 'delayed' || job.status === 'running') active.push(row);
        else recent.push(row);
    });
    localJobs.forEach((job) => active.push(publicLocalJob(job)));
    localRecent.forEach((job) => recent.push(publicLocalJob(job)));
    active.sort((a, b) => (a.submitted || 0) - (b.submitted || 0));
    recent.sort((a, b) => (b.finished || 0) - (a.finished || 0));

    const count = (id) => active.filter((job) => job.printer === id).length;
    const printing = (id) => active.some((job) => job.printer === id && job.status === 'running');
    const printers = [{
        id: NAI_PRINTER_ID,
        name: 'NovelAI',
        port: 'image.novelai.net',
        driver: 'NovelAI Diffusion',
        provider: 'NovelAI',
        kind: 'novelai',
        isDefault: true,
        status: printing(NAI_PRINTER_ID) ? 'Printing' : 'Ready',
        jobs: count(NAI_PRINTER_ID)
    }];
    readWorkers(gr).forEach((worker) => {
        const id = `local:${worker.id}`;
        const health = workerRow(worker);
        let status = printing(id) ? 'Printing' : 'Ready';
        if (health.known && !health.online) status = 'Offline';
        printers.push({
            id,
            name: worker.name,
            port: worker.host || worker.id,
            driver: worker.animate ? `${worker.name} Local Worker (Upscale, Animate)` : `${worker.name} Local Worker (Upscale)`,
            provider: 'Dreamscape',
            kind: 'local',
            isDefault: false,
            status,
            jobs: count(id)
        });
    });
    // a worker that left the config while its job runs still shows as its printer
    active.concat(recent).forEach((job) => {
        if (printers.some((p) => p.id === job.printer)) return;
        const name = String(job.printer).replace(/^local:/, '');
        printers.push({
            id: job.printer,
            name: name.charAt(0).toUpperCase() + name.slice(1),
            port: name,
            driver: `${name} Local Worker`,
            provider: 'Dreamscape',
            kind: 'local',
            isDefault: false,
            status: printing(job.printer) ? 'Printing' : 'Ready',
            jobs: count(job.printer)
        });
    });
    return {
        at: Date.now(),
        printers,
        jobs: active,
        recent: recent.slice(0, RECENT_LIMIT)
    };
}

/** Re-read the local workers' health (15 s cached in localUpscaleWorker) for the printer status. */
async function refreshWorkerHealth(globalResources) {
    const gr = globalResources || boundResources;
    try {
        const luw = require('./localUpscaleWorker');
        if (!luw.readLocalWorkers(gr).length) return;
        workerHealth = await luw.checkLocalWorkerHealth(gr);
        workerHealthAt = Date.now();
    } catch (_err) { /* the status stays as it was */ }
}

// ---- pushes ---------------------------------------------------------------------------------------

function pushFilter(info) {
    return !!(info && info.authenticated && (info.userType === 'admin' || info.userType === 'dev_admin'));
}

function pushNow() {
    pushTimer = null;
    const gr = boundResources;
    if (!gr || typeof gr.getWebSocketServer !== 'function') return;
    let server = null;
    try { server = gr.getWebSocketServer(); } catch (_err) { server = null; }
    if (!server || typeof server.broadcast !== 'function') return;
    try {
        server.broadcast({ type: 'print_queue_state', data: buildState(gr), timestamp: new Date().toISOString() }, pushFilter);
    } catch (err) {
        console.warn('[printSpooler] push failed:', err && err.message ? err.message : err);
    }
}

function schedulePush() {
    if (!boundResources || pushTimer) return;
    pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
    if (pushTimer && typeof pushTimer.unref === 'function') pushTimer.unref();
}

/** Start pushing (once; the WS packet module calls it when it registers). */
function bind(globalResources) {
    if (!globalResources) return;
    boundResources = globalResources;
    if (unsubscribeQueue) return;
    const queue = sharedQueue(globalResources);
    if (queue && typeof queue.onChange === 'function') {
        unsubscribeQueue = queue.onChange(() => schedulePush());
    }
}

// ---- commands -------------------------------------------------------------------------------------

/**
 * Document > Cancel. A waiting document leaves the FIFO; a Studio document that is printing is
 * cancelled as Studio's own Cancel does (markGenerationCancelled on its requestId). MCP documents
 * that are printing and local worker jobs cannot be cancelled.
 * ctx: { handlers, clientInfo }. admin cancels any document, dev_admin only its own session's.
 */
function cancelDocument(globalResources, jobId, ctx) {
    const id = String(jobId || '');
    const info = (ctx && ctx.clientInfo) || {};
    const handlers = ctx && ctx.handlers;
    const queue = sharedQueue(globalResources);
    const job = queue && typeof queue.get === 'function' ? queue.get(id) : null;
    if (!job) {
        if (localJobs.has(id)) return { success: false, code: 'NOT_SUPPORTED', error: 'This document cannot be cancelled.' };
        return { success: false, code: 'NOT_FOUND', error: 'The document is no longer in the queue.' };
    }
    const mine = !!(info.sessionId && job.caller === `session:${info.sessionId}`);
    if (info.userType !== 'admin' && !mine) {
        return { success: false, code: 'ACCESS_DENIED', error: 'You do not have permission to cancel this document.' };
    }
    if (job.status === 'queued' || job.status === 'delayed') {
        const ok = queue.cancel(id, 'Cancelled from the print queue');
        if (ok && job.requestId && handlers && typeof handlers.stopKeepAliveInterval === 'function') {
            try { handlers.stopKeepAliveInterval(job.requestId); } catch (_err) { /* */ }
        }
        try {
            require('./generationRequestLog').patchGenerationRequest(globalResources, id, {
                status: 'cancelled', finishedAt: Date.now(), error: 'Cancelled from the print queue'
            });
        } catch (_err) { /* history must not block the cancel */ }
        schedulePush();
        return { success: ok, cancelled: ok ? 'queued' : null };
    }
    if (job.status === 'running' && job.source === 'ws' && job.requestId && handlers
        && typeof handlers.markGenerationCancelled === 'function') {
        handlers.markGenerationCancelled(job.requestId);
        job.cancelRequested = true;
        schedulePush();
        return { success: true, cancelled: 'running' };
    }
    return { success: false, code: 'NOT_SUPPORTED', error: 'This document cannot be cancelled while it prints.' };
}

/** Print Management's job history: the durable generation request log, newest first. */
function history(globalResources, query) {
    const q = query && typeof query === 'object' ? query : {};
    const { queryGenerationRequests } = require('./generationRequestLog');
    const page = queryGenerationRequests(globalResources, { limit: Math.min(200, Number(q.limit) || 100), offset: Number(q.offset) || 0 });
    return {
        total: page.total,
        jobs: page.requests.map((row) => ({
            id: row.jobId,
            printer: NAI_PRINTER_ID,
            type: row.type,
            // the log keeps no prompt text: a printed document is named by the file it printed
            name: (row.imageIds && row.imageIds[0]) || (row.type === 'reroll_image' ? 'Reroll' : 'Untitled'),
            status: row.status,
            statusText: VISTA_STATUS[row.status] != null ? VISTA_STATUS[row.status] : '',
            owner: row.owner || ownerFromCaller(row.caller),
            pages: row.pages || (row.imageIds && row.imageIds.length) || 1,
            submitted: row.createdAt ? Date.parse(row.createdAt) : null,
            finished: row.finishedAt ? Date.parse(row.finishedAt) : null,
            workspace: row.workspace || null,
            images: (row.imageIds || []).slice(0, 8),
            error: row.error || null
        }))
    };
}

function resetForTests() {
    localJobs.clear();
    localRecent.length = 0;
    if (unsubscribeQueue) unsubscribeQueue();
    unsubscribeQueue = null;
    boundResources = null;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    workerHealth = null;
    workerHealthAt = 0;
}

module.exports = {
    NAI_PRINTER_ID,
    describeDocument,
    ownerFromClient,
    ownerFromCaller,
    sessionTag,
    beginLocalJob,
    updateLocalJob,
    endLocalJob,
    buildState,
    refreshWorkerHealth,
    bind,
    schedulePush,
    cancelDocument,
    history,
    _resetForTests: resetForTests
};
