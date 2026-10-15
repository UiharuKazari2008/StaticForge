'use strict';

/**
 * G10 RealESRGAN worker (realesrgan-ncnn-vulkan on the Vega 8).
 *
 * Same job API as the Ruiko worker: GET /health, GET /models, POST /jobs,
 * GET /jobs/:id, GET /jobs/:id/result. Binds 127.0.0.1 only. Bearer auth.
 *
 * realesrgan-ncnn-vulkan can exit 0 after a Vulkan queue failure. Output that
 * contains "vkQueueSubmit failed" is a failed job.
 *
 *   node services/g10-upscaler/server.js
 *
 * Env: G10_WORKER_KEY or G10_WORKER_KEY_FILE, G10_PORT (default 8190),
 * G10_REALESRGAN_BIN, G10_MODEL_DIR, G10_GPU_NAME, G10_ENABLE_X4PLUS=1.
 * Sala installs this. Do not register it from Dreamscape's ecosystem config.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const VERSION = '1.0.0';
const SERVICE = 'g10-upscaler';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_QUEUE = 8;
const JOB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_PORT = 8190;
const DEFAULT_BIN = '/home/kanmi/opt/realesrgan/realesrgan-ncnn-vulkan';
const DEFAULT_MODELS = '/home/kanmi/opt/realesrgan/models';
const GPU_FAILURE = 'vkQueueSubmit failed';

const MODEL_CATALOG = [
    {
        id: 'realesr-animevideov3',
        binary: 'realesr-animevideov3',
        name: 'realesr-animevideov3',
        scale: 4,
        scales: [2, 4],
        speed: 'fast',
        enabled: true,
        optional: false
    },
    {
        id: 'realesrgan-x4plus-anime',
        binary: 'realesrgan-x4plus-anime',
        name: 'realesrgan-x4plus-anime',
        scale: 4,
        scales: [4],
        speed: 'slow',
        enabled: true,
        optional: false,
        note: 'About 34s on Vega 8.'
    },
    {
        id: 'realesrgan-x4plus',
        binary: 'realesrgan-x4plus',
        name: 'RealESRGAN x4plus',
        scale: 4,
        scales: [4],
        speed: 'slow',
        enabled: false,
        optional: true,
        note: 'Disabled by default: vkQueueSubmit GPU resets on Vega 8.'
    }
];

const MODEL_ALIASES = {
    realesrgan_x4plus: 'realesrgan-x4plus',
    'realesrgan-x4plus': 'realesrgan-x4plus',
    realesrgan_x4plus_anime: 'realesrgan-x4plus-anime',
    'realesrgan-x4plus-anime': 'realesrgan-x4plus-anime',
    'realesr-animevideov3': 'realesr-animevideov3'
};

function gpuFailureFromOutput(text) {
    const blob = String(text || '');
    if (blob.toLowerCase().indexOf(GPU_FAILURE.toLowerCase()) !== -1) return GPU_FAILURE;
    return '';
}

function readKeyFile(file) {
    try {
        return String(fs.readFileSync(file, 'utf8') || '').trim();
    } catch (_) {
        return '';
    }
}

function resolveKey(options) {
    if (options && options.key) return String(options.key).trim();
    const fromEnv = String(process.env.G10_WORKER_KEY || '').trim();
    if (fromEnv) return fromEnv;
    const file = (options && options.keyFile) || process.env.G10_WORKER_KEY_FILE;
    if (file) return readKeyFile(file);
    return '';
}

function catalog(enableX4plus) {
    return MODEL_CATALOG.map((row) => {
        const copy = Object.assign({}, row);
        if (row.id === 'realesrgan-x4plus') copy.enabled = !!enableX4plus;
        return copy;
    });
}

function publicModel(row) {
    const out = {
        id: row.id,
        name: row.name,
        scale: row.scale,
        scales: row.scales.slice(),
        speed: row.speed,
        enabled: !!row.enabled,
        optional: !!row.optional
    };
    if (row.note) out.note = row.note;
    return out;
}

function resolveModel(raw, rows) {
    const text = String(raw || '').trim();
    const alias = MODEL_ALIASES[text] || MODEL_ALIASES[text.toLowerCase()] || text;
    return rows.find((row) => row.id === alias || row.id === text) || null;
}

function keysMatch(got, expected) {
    const a = Buffer.from(String(got || ''));
    const b = Buffer.from(String(expected || ''));
    if (!b.length || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function bearer(req) {
    const header = String(req.headers.authorization || '');
    if (header.slice(0, 7).toLowerCase() !== 'bearer ') return '';
    return header.slice(7).trim();
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                const error = new Error('body exceeds 32 MB');
                error.status = 413;
                reject(error);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function decodeImage(raw) {
    if (raw == null) throw Object.assign(new Error('image is required'), { status: 400 });
    let text = String(raw).trim();
    if (text.startsWith('data:')) text = text.split(',').slice(1).join(',');
    let data;
    try {
        data = Buffer.from(text, 'base64');
    } catch (_) {
        throw Object.assign(new Error('image is not valid base64'), { status: 400 });
    }
    if (!data.length) throw Object.assign(new Error('image is empty'), { status: 400 });
    if (data.length > MAX_BYTES) throw Object.assign(new Error('image exceeds 32 MB'), { status: 400 });
    return data;
}

function runBinary(bin, args, cwd) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(bin, args, { cwd: cwd || path.dirname(bin) });
        } catch (err) {
            resolve({ code: 1, output: err && err.message ? err.message : 'spawn failed' });
            return;
        }
        let output = '';
        const take = (chunk) => {
            output += chunk.toString();
            if (output.length > 200000) output = output.slice(-200000);
        };
        if (child.stdout) child.stdout.on('data', take);
        if (child.stderr) child.stderr.on('data', take);
        child.on('error', (err) => {
            output += (err && err.message) ? err.message : 'spawn failed';
            resolve({ code: 1, output });
        });
        child.on('close', (code) => {
            resolve({ code: code == null ? 1 : code, output });
        });
    });
}

function sweep(state) {
    const now = Date.now();
    for (const [id, job] of state.jobs) {
        if (job.finished && (now - job.finished) >= JOB_TTL_MS) state.jobs.delete(id);
    }
}

function queueLength(state) {
    let n = 0;
    for (const job of state.jobs.values()) {
        if (job.status === 'queued' || job.status === 'running') n += 1;
    }
    return n;
}

function createState(options) {
    const enableX4plus = options.enableX4plus != null
        ? !!options.enableX4plus
        : String(process.env.G10_ENABLE_X4PLUS || '') === '1';
    return {
        key: resolveKey(options),
        bin: (options.bin || process.env.G10_REALESRGAN_BIN || DEFAULT_BIN),
        modelDir: (options.modelDir || process.env.G10_MODEL_DIR || DEFAULT_MODELS),
        gpu: (options.gpu || process.env.G10_GPU_NAME || 'AMD Radeon Vega 8'),
        models: catalog(enableX4plus),
        jobs: new Map(),
        queue: [],
        active: null,
        runBinary: options.runBinary || runBinary
    };
}

function publicJob(job) {
    return {
        job_id: job.id,
        type: 'upscale',
        status: job.status,
        progress: job.progress,
        error: job.error,
        model: job.model,
        scale: job.scale
    };
}

async function executeJob(state, job) {
    const row = resolveModel(job.model, state.models);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g10-upscale-'));
    const input = path.join(dir, 'in.png');
    const output = path.join(dir, 'out.png');
    job.status = 'running';
    job.progress = 10;
    try {
        fs.writeFileSync(input, job.image);
        const args = ['-i', input, '-o', output, '-n', row.binary, '-s', String(job.scale), '-m', state.modelDir, '-f', 'png'];
        const result = await state.runBinary(state.bin, args, path.dirname(state.bin));
        const gpuError = gpuFailureFromOutput(result.output);
        if (gpuError) {
            job.status = 'failed';
            job.error = gpuError;
            job.progress = 100;
            return;
        }
        if (result.code !== 0) {
            job.status = 'failed';
            job.error = (result.output || '').trim().slice(0, 400) || ('exit ' + result.code);
            job.progress = 100;
            return;
        }
        if (!fs.existsSync(output) || fs.statSync(output).size < 8) {
            job.status = 'failed';
            job.error = 'realesrgan produced no output image';
            job.progress = 100;
            return;
        }
        job.result = fs.readFileSync(output);
        job.status = 'completed';
        job.progress = 100;
        job.error = null;
    } catch (err) {
        job.status = 'failed';
        job.error = err && err.message ? err.message : 'upscale failed';
        job.progress = 100;
    } finally {
        job.finished = Date.now();
        job.image = null;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function pump(state) {
    if (state.active) return;
    const id = state.queue.shift();
    if (!id) return;
    const job = state.jobs.get(id);
    if (!job) {
        pump(state);
        return;
    }
    state.active = id;
    executeJob(state, job).finally(() => {
        if (state.active === id) state.active = null;
        pump(state);
    });
}

function enqueue(state, job) {
    if (queueLength(state) >= MAX_QUEUE) {
        const error = new Error('queue is full');
        error.status = 503;
        throw error;
    }
    state.jobs.set(job.id, job);
    state.queue.push(job.id);
    pump(state);
    return job.id;
}

async function handle(req, res, state) {
    const url = (req.url || '').split('?')[0];
    const authed = keysMatch(bearer(req), state.key);
    try {
        if (req.method === 'GET' && url === '/health') {
            sweep(state);
            if (!authed) {
                sendJson(res, 200, { ok: true, service: SERVICE, version: VERSION, auth: 'required' });
                return;
            }
            sendJson(res, 200, {
                ok: true,
                auth: 'ok',
                service: SERVICE,
                version: VERSION,
                gpu: state.gpu,
                queue_length: queueLength(state),
                job_types: ['upscale'],
                loaded_models: []
            });
            return;
        }
        if (!state.key) {
            sendJson(res, 503, { error: 'worker key is not configured' });
            return;
        }
        if (!authed) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        if (req.method === 'GET' && url === '/models') {
            sendJson(res, 200, { models: state.models.map(publicModel) });
            return;
        }
        if (req.method === 'POST' && url === '/jobs') {
            const raw = await readBody(req, MAX_BYTES + 1024 * 1024);
            let payload;
            try {
                payload = JSON.parse(raw.toString('utf8') || '{}');
            } catch (_) {
                sendJson(res, 400, { error: 'invalid JSON' });
                return;
            }
            const row = resolveModel(payload.model || 'realesr-animevideov3', state.models);
            if (!row) {
                sendJson(res, 400, { error: 'unknown model' });
                return;
            }
            if (!row.enabled) {
                sendJson(res, 400, { error: row.id + ' is disabled (' + (row.note || 'optional model') + ')' });
                return;
            }
            const scale = Number(payload.scale) === 2 ? 2 : 4;
            if (row.scales.indexOf(scale) === -1) {
                sendJson(res, 400, { error: row.id + ' does not support scale ' + scale });
                return;
            }
            const image = decodeImage(payload.image);
            const job = {
                id: crypto.randomBytes(8).toString('hex'),
                model: row.id,
                scale,
                image,
                status: 'queued',
                progress: 0,
                error: null,
                result: null,
                finished: null
            };
            const jobId = enqueue(state, job);
            sendJson(res, 200, { job_id: jobId });
            return;
        }
        const statusMatch = url.match(/^\/jobs\/([^/]+)$/);
        if (req.method === 'GET' && statusMatch) {
            const job = state.jobs.get(statusMatch[1]);
            if (!job) {
                sendJson(res, 404, { error: 'job not found' });
                return;
            }
            sendJson(res, 200, publicJob(job));
            return;
        }
        const resultMatch = url.match(/^\/jobs\/([^/]+)\/result$/);
        if (req.method === 'GET' && resultMatch) {
            const job = state.jobs.get(resultMatch[1]);
            if (!job) {
                sendJson(res, 404, { error: 'job not found' });
                return;
            }
            if (job.status !== 'completed' || !job.result) {
                sendJson(res, 409, { error: job.error || 'job is not complete' });
                return;
            }
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': job.result.length });
            res.end(job.result);
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    } catch (err) {
        const status = err && err.status ? err.status : 500;
        if (!res.headersSent) sendJson(res, status, { error: err && err.message ? err.message : 'error' });
    }
}

function createWorkerServer(options = {}) {
    const state = createState(options);
    const server = http.createServer((req, res) => {
        handle(req, res, state);
    });
    const port = options.port != null ? options.port : 0;
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                host: address.address,
                port: address.port,
                close() {
                    return new Promise((done) => server.close(() => done()));
                }
            });
        });
    });
}

if (require.main === module) {
    const port = Number(process.env.G10_PORT) || DEFAULT_PORT;
    createWorkerServer({ port }).then((listener) => {
        process.stdout.write(SERVICE + ' listening on http://' + listener.host + ':' + listener.port + '\n');
    }).catch((err) => {
        process.stderr.write((err && err.message ? err.message : 'listen failed') + '\n');
        process.exit(1);
    });
}

module.exports = {
    VERSION,
    GPU_FAILURE,
    MODEL_CATALOG,
    gpuFailureFromOutput,
    catalog,
    publicModel,
    resolveModel,
    createWorkerServer
};
