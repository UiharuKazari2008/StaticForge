/**
 * Global FIFO for NovelAI generations (Studio WS + MCP).
 * One job at a time. Semi-random gap after each finished job so bursts cannot stack.
 */

const crypto = require('crypto');

const DEFAULT_DELAY_MIN_MS = 8000;
const DEFAULT_DELAY_MAX_MS = 20000;
const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;
const DEFAULT_AWAIT_TIMEOUT_MS = 12 * 60 * 1000;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function randomDelayMs(minMs, maxMs) {
    const lo = Math.max(0, Number(minMs) || 0);
    const hi = Math.max(lo, Number(maxMs) || lo);
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function createJobId() {
    return `gjob_${crypto.randomBytes(8).toString('hex')}`;
}

function createGenerationJobQueue(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const delayMinMs = opts.delayMinMs != null ? Number(opts.delayMinMs) : DEFAULT_DELAY_MIN_MS;
    const delayMaxMs = opts.delayMaxMs != null ? Number(opts.delayMaxMs) : DEFAULT_DELAY_MAX_MS;
    const jobTtlMs = opts.jobTtlMs != null ? Number(opts.jobTtlMs) : DEFAULT_JOB_TTL_MS;
    const nowFn = opts.now || Date.now;

    const jobs = new Map();
    const pending = [];
    let running = null;
    let pumping = false;
    let cooldownUntil = 0;
    let lastFinishedAt = 0;

    function prune() {
        const cutoff = nowFn() - jobTtlMs;
        jobs.forEach((job, id) => {
            if (job.finishedAt && job.finishedAt < cutoff) {
                jobs.delete(id);
            }
        });
    }

    function positionOf(job) {
        if (running && running.id === job.id) return 0;
        const idx = pending.findIndex((row) => row.id === job.id);
        return idx < 0 ? -1 : idx + (running ? 1 : 0);
    }

    function estimatedDelayMs(job) {
        const pos = positionOf(job);
        if (pos < 0) return 0;
        const cooldownLeft = Math.max(0, cooldownUntil - nowFn());
        if (pos === 0 && !running) return cooldownLeft;
        return cooldownLeft + pos * Math.round((delayMinMs + delayMaxMs) / 2);
    }

    function snapshot(job) {
        const result = job.result && typeof job.result === 'object' ? job.result : {};
        const flat = result.flat && typeof result.flat === 'object' ? result.flat : {};
        return {
            jobId: job.id,
            status: job.status,
            type: job.type,
            source: job.source,
            requestId: job.requestId || null,
            position: Math.max(0, positionOf(job)),
            delayMs: estimatedDelayMs(job),
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            success: job.status === 'completed' ? result.success !== false : null,
            filename: flat.filename || result.filename || null,
            filenames: flat.filenames || result.filenames || null,
            destPath: job.destPath || flat.dest_path || null,
            seed: flat.seed || result.seed || null,
            error: job.status === 'failed'
                ? (job.error && job.error.message) || flat.error || 'generation failed'
                : null
        };
    }

    function settle(job, err) {
        if (job.settled) return;
        job.settled = true;
        if (err) {
            job.rejecters.forEach((reject) => reject(err));
        } else {
            job.resolvers.forEach((resolve) => resolve(job.result));
        }
        job.resolvers = [];
        job.rejecters = [];
    }

    async function pump() {
        if (pumping) return;
        pumping = true;
        try {
            while (pending.length) {
                const job = pending.shift();
                running = job;
                const waitMs = Math.max(0, cooldownUntil - nowFn());
                if (waitMs > 0) {
                    job.status = 'delayed';
                    await sleep(waitMs);
                }
                if (job.status === 'cancelled') {
                    running = null;
                    continue;
                }
                job.status = 'running';
                job.startedAt = nowFn();
                try {
                    job.result = await job.run();
                    job.status = 'completed';
                    job.finishedAt = nowFn();
                    lastFinishedAt = job.finishedAt;
                    cooldownUntil = lastFinishedAt + randomDelayMs(delayMinMs, delayMaxMs);
                    settle(job, null);
                } catch (err) {
                    job.error = err;
                    job.status = 'failed';
                    job.finishedAt = nowFn();
                    lastFinishedAt = job.finishedAt;
                    cooldownUntil = lastFinishedAt + randomDelayMs(delayMinMs, delayMaxMs);
                    settle(job, err);
                }
                running = null;
            }
        } finally {
            pumping = false;
            if (pending.length && !running) {
                setImmediate(pump);
            }
        }
    }

    function submit(meta) {
        prune();
        const info = meta && typeof meta === 'object' ? meta : {};
        const job = {
            id: createJobId(),
            type: String(info.type || 'generate_image'),
            source: String(info.source || 'unknown'),
            requestId: info.requestId || null,
            destPath: info.destPath || info.dest_path || null,
            status: 'queued',
            createdAt: nowFn(),
            startedAt: null,
            finishedAt: null,
            result: null,
            error: null,
            settled: false,
            resolvers: [],
            rejecters: [],
            run: info.run
        };
        if (typeof job.run !== 'function') {
            const err = new Error('generation job run() is required');
            err.status = 500;
            throw err;
        }
        const promise = new Promise((resolve, reject) => {
            job.resolvers.push(resolve);
            job.rejecters.push(reject);
        });
        job.promise = promise;
        jobs.set(job.id, job);
        pending.push(job);
        setImmediate(pump);
        return {
            id: job.id,
            status: job.status,
            position: positionOf(job),
            estimatedDelayMs: estimatedDelayMs(job),
            promise
        };
    }

    function get(jobId) {
        prune();
        return jobs.get(String(jobId || '')) || null;
    }

    function wait(jobId, timeoutMs) {
        const job = get(jobId);
        if (!job) {
            const err = new Error('Unknown generation jobId');
            err.status = 404;
            err.code = 'GENERATION_JOB_NOT_FOUND';
            return Promise.reject(err);
        }
        if (job.status === 'completed') return Promise.resolve(job.result);
        if (job.status === 'failed') return Promise.reject(job.error || new Error('generation failed'));
        if (job.status === 'cancelled') {
            const err = new Error('Generation job cancelled');
            err.status = 409;
            err.code = 'GENERATION_JOB_CANCELLED';
            return Promise.reject(err);
        }
        const cap = timeoutMs != null ? Number(timeoutMs) : DEFAULT_AWAIT_TIMEOUT_MS;
        if (!cap || cap <= 0) return job.promise;
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error('Timed out waiting for generation job');
                err.status = 504;
                err.code = 'GENERATION_JOB_TIMEOUT';
                reject(err);
            }, cap);
        });
        return Promise.race([job.promise, timeoutPromise]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }

    function cancel(jobId, reason) {
        const job = get(jobId);
        if (!job) return false;
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'running') {
            return false;
        }
        const idx = pending.findIndex((row) => row.id === job.id);
        if (idx >= 0) pending.splice(idx, 1);
        job.status = 'cancelled';
        job.finishedAt = nowFn();
        const err = new Error(reason || 'Generation job cancelled');
        err.status = 409;
        err.code = 'GENERATION_JOB_CANCELLED';
        job.error = err;
        settle(job, err);
        return true;
    }

    function cancelByRequestId(requestId) {
        const id = String(requestId || '');
        if (!id) return 0;
        let count = 0;
        jobs.forEach((job) => {
            if (job.requestId === id && cancel(job.id, 'Cancelled by requestId')) count += 1;
        });
        return count;
    }

    function listPublic() {
        prune();
        return Array.from(jobs.values()).map(snapshot);
    }

    return {
        delayMinMs,
        delayMaxMs,
        submit,
        get,
        wait,
        cancel,
        cancelByRequestId,
        snapshot,
        listPublic,
        _state: () => ({ pending: pending.length, running: running && running.id, cooldownUntil, lastFinishedAt })
    };
}

let sharedQueue = null;

function getSharedGenerationJobQueue() {
    if (!sharedQueue) sharedQueue = createGenerationJobQueue();
    return sharedQueue;
}

function notifyGenerationQueued(handlers, ws, requestId, job) {
    handlers.sendToClient(ws, {
        type: 'image_generation_progress',
        requestId,
        data: {
            phase: 'queued',
            jobId: job.id,
            position: job.position,
            delayMs: job.estimatedDelayMs
        },
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    DEFAULT_DELAY_MIN_MS,
    DEFAULT_DELAY_MAX_MS,
    DEFAULT_JOB_TTL_MS,
    DEFAULT_AWAIT_TIMEOUT_MS,
    createGenerationJobQueue,
    getSharedGenerationJobQueue,
    notifyGenerationQueued
};
