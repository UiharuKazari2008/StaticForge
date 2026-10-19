'use strict';

// In-process busy snapshot for scripts/director-idle-check.js (Yozora #565).
// The loopback server is 127.0.0.1 only. A JSON snapshot next to it keeps
// checkIdle() synchronous (cursorDirector.updateAgentClis reads it).

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const smtpSessions = new Map();
const httpRequests = new Map();
const localJobs = new Map();
let smtpSeq = 0;
let httpSeq = 0;
let server = null;
let listenPort = 0;
let snapshotPath = null;
let writeTimer = null;

function defaultSnapshotPath(home) {
    return path.join(home || os.homedir(), '.cache', 'dreamscape', 'busy-status.json');
}

function beginSmtp(info) {
    const id = ++smtpSeq;
    smtpSessions.set(id, {
        id,
        peer: info && info.peer ? String(info.peer) : null,
        at: Date.now()
    });
    scheduleSnapshot();
    return id;
}

function endSmtp(id) {
    if (smtpSessions.delete(id)) scheduleSnapshot();
}

function beginHttp(req) {
    const id = ++httpSeq;
    const url = req && req.url ? String(req.url).split('?')[0] : '';
    httpRequests.set(id, {
        id,
        method: req && req.method ? String(req.method) : 'GET',
        path: url.slice(0, 120),
        at: Date.now()
    });
    scheduleSnapshot();
    return id;
}

function endHttp(id) {
    if (httpRequests.delete(id)) scheduleSnapshot();
}

function beginLocalJob(kind, jobId) {
    const id = String(jobId || `${kind}-${Date.now()}`);
    localJobs.set(id, { kind: kind === 'animate' ? 'animate' : 'upscale', jobId: id, at: Date.now() });
    scheduleSnapshot();
    return id;
}

function endLocalJob(jobId) {
    if (localJobs.delete(String(jobId))) scheduleSnapshot();
}

function listDirectorRuns() {
    try {
        const wren = require('./cursorDirector');
        if (typeof wren.listActiveRuns === 'function') return wren.listActiveRuns();
    } catch (_err) { /* director optional in tests */ }
    return [];
}

function listXiRuns() {
    try {
        const xi = require('./xiDirector');
        if (typeof xi.listActiveRuns === 'function') return xi.listActiveRuns();
    } catch (_err) { /* xi optional */ }
    return [];
}

function listGeneration(globalResources) {
    const empty = { processing: false, pending: 0, running: null, in5min: 0, in15min: 0 };
    let fifo = { pending: 0, running: null };
    try {
        const { getSharedGenerationJobQueue } = require('./generationJobQueue');
        const queue = getSharedGenerationJobQueue();
        const jobs = queue && typeof queue.listPublic === 'function' ? queue.listPublic() : [];
        const live = jobs.filter((job) => job && (job.status === 'pending' || job.status === 'running' || job.status === 'delayed'));
        fifo = {
            pending: live.filter((job) => job.status !== 'running').length,
            running: ((live.find((job) => job.status === 'running') || {}).jobId) || null
        };
    } catch (_err) { /* FIFO optional in tests */ }
    let rate = { processing: false, in5min: 0, in15min: 0 };
    try {
        const gr = globalResources;
        if (gr && gr.initialized && typeof gr.getQueue === 'function') {
            const queue = gr.getQueue();
            if (queue) {
                const status = typeof queue.getStatus === 'function' ? queue.getStatus() : {};
                rate = {
                    processing: queue.isProcessing === true,
                    in5min: Number(status.in5min) || 0,
                    in15min: Number(status.in15min) || 0
                };
            }
        }
    } catch (_err) { /* rate-limit queue optional */ }
    return {
        processing: !!fifo.running || fifo.pending > 0 || rate.processing,
        pending: fifo.pending,
        running: fifo.running,
        in5min: rate.in5min,
        in15min: rate.in15min
    };
}

function listMcp() {
    try {
        const activity = require('./mcpActivity');
        if (typeof activity.getInflight === 'function') return activity.getInflight();
    } catch (_err) { /* facade not loaded */ }
    return [];
}

function collect(options) {
    const opts = options || {};
    const director = Array.isArray(opts.director) ? opts.director : listDirectorRuns();
    const xi = Array.isArray(opts.xi) ? opts.xi : listXiRuns();
    const generation = opts.generation || listGeneration(opts.globalResources);
    const jobs = Array.isArray(opts.localJobs) ? opts.localJobs : Array.from(localJobs.values());
    const mcp = Array.isArray(opts.mcp) ? opts.mcp : listMcp();
    const smtp = Array.isArray(opts.smtp) ? opts.smtp : Array.from(smtpSessions.values());
    const httpInflight = Array.isArray(opts.http) ? opts.http : Array.from(httpRequests.values());
    const reasons = [];
    director.forEach((row) => {
        if (row && row.sessionId) reasons.push(`director:${row.sessionId}`);
    });
    xi.forEach((row) => {
        if (row && row.sessionId) reasons.push(`xi:${row.sessionId}`);
    });
    if (generation && generation.processing) reasons.push('generation-queue');
    jobs.forEach((job) => {
        if (job && job.jobId) reasons.push(`${job.kind || 'job'}:${job.jobId}`);
    });
    mcp.forEach((row) => {
        const key = (row && (row.key || row.actorName)) || 'unknown';
        const tool = (row && row.tool) || 'tool';
        reasons.push(`mcp:${key}:${tool}`);
    });
    if (smtp.length) reasons.push(`smtp:${smtp.length}`);
    if (httpInflight.length) reasons.push(`http:${httpInflight.length}`);
    return {
        busy: reasons.length > 0,
        reasons,
        director,
        xi,
        generation,
        localJobs: jobs,
        mcp,
        smtp,
        http: httpInflight
    };
}

function writeSnapshot(status) {
    if (!snapshotPath) return;
    try {
        fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
        const body = JSON.stringify({
            pid: process.pid,
            port: listenPort,
            at: Date.now(),
            status: status || collect()
        });
        const tmp = `${snapshotPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, snapshotPath);
    } catch (_err) { /* snapshot is best-effort */ }
}

function scheduleSnapshot() {
    if (!snapshotPath || writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        writeSnapshot();
    }, 25);
    if (writeTimer && typeof writeTimer.unref === 'function') writeTimer.unref();
}

function startLoopback(options) {
    const opts = options || {};
    if (server && listenPort) {
        return Promise.resolve({ port: listenPort, url: `http://127.0.0.1:${listenPort}`, file: snapshotPath });
    }
    snapshotPath = opts.file || defaultSnapshotPath(opts.home);
    return new Promise((resolve, reject) => {
        const httpServer = http.createServer((req, res) => {
            const url = String(req.url || '').split('?')[0];
            if (req.method === 'GET' && (url === '/busy' || url === '/')) {
                const status = collect(opts.collect);
                writeSnapshot(status);
                const text = JSON.stringify(status);
                res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
                res.end(text);
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
        });
        httpServer.on('error', (error) => {
            if (!server) reject(error);
        });
        httpServer.listen(0, '127.0.0.1', () => {
            listenPort = httpServer.address().port;
            server = httpServer;
            httpServer.unref();
            writeSnapshot();
            resolve({
                port: listenPort,
                url: `http://127.0.0.1:${listenPort}`,
                file: snapshotPath
            });
        });
    });
}

function stopLoopback() {
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    if (server) {
        try { server.close(); } catch (_err) { /* already closed */ }
        server = null;
        listenPort = 0;
    }
}

function attachExpress(app) {
    if (!app || typeof app.use !== 'function') return;
    app.use((req, res, next) => {
        const id = beginHttp(req);
        let ended = false;
        const done = () => {
            if (ended) return;
            ended = true;
            endHttp(id);
        };
        res.once('finish', done);
        res.once('close', done);
        next();
    });
}

function resetForTests() {
    smtpSessions.clear();
    httpRequests.clear();
    localJobs.clear();
    smtpSeq = 0;
    httpSeq = 0;
    stopLoopback();
    snapshotPath = null;
}

function readSnapshot(file, home) {
    const target = file || defaultSnapshotPath(home);
    try {
        const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch (_err) {
        return null;
    }
}

module.exports = {
    defaultSnapshotPath,
    beginSmtp,
    endSmtp,
    beginHttp,
    endHttp,
    beginLocalJob,
    endLocalJob,
    collect,
    startLoopback,
    stopLoopback,
    attachExpress,
    writeSnapshot,
    readSnapshot,
    resetForTests,
    _test: {
        smtpSessions,
        httpRequests,
        localJobs
    }
};
