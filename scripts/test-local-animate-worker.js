'use strict';

/**
 * Local Ruiko animate client against an in-process mock worker.
 * No GPU, no NovelAI, no Anlas. Mirrors test-local-upscale-worker.js.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
    clearLocalWorkerHealthCache,
    animateBufferWithLocalWorker
} = require('../modules/localUpscaleWorker');

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);
const GIF_BYTES = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])]);
const MP4_BYTES = Buffer.from('fake-mp4-bytes');
const WEBP_BYTES = Buffer.from('fake-webp-bytes');

function listen(handler) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function resources(url, key) {
    return {
        getSecureConfig() {
            return { url, key };
        }
    };
}

async function main() {
    const hits = { health: 0, jobs: 0 };
    const jobs = new Map();
    const server = await listen(async (req, res) => {
        const [url, qs] = (req.url || '').split('?');
        const query = new URLSearchParams(qs || '');
        const auth = req.headers.authorization || '';
        if (url === '/health') {
            hits.health += 1;
            const body = auth === 'Bearer test-key'
                ? {
                    ok: true,
                    auth: 'ok',
                    version: '1.0.0',
                    gpu: 'Test GPU',
                    queue_length: jobs.size,
                    loaded_models: [],
                    job_types: ['upscale', 'animate'],
                    animate_backends: ['animatediff', 'wan'],
                    animate_loaded: []
                }
                : { ok: true, service: 'ruiko-upscaler', version: '1.0.0', auth: 'required' };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
            return;
        }
        if (auth !== 'Bearer test-key') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
        }
        if (req.method === 'POST' && url === '/jobs') {
            hits.jobs += 1;
            const payload = JSON.parse((await readBody(req)).toString('utf8'));
            assert.strictEqual(payload.type, 'animate');
            assert.ok(payload.motion_prompt && payload.motion_prompt.length > 0);
            assert.ok(payload.image && payload.image.length > 10);
            const jobId = 'job-animate-1';
            jobs.set(jobId, {
                status: 'completed',
                progress: 100,
                error: null,
                backend: payload.backend,
                frames: payload.frames,
                fps: payload.fps,
                loop: payload.loop
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ job_id: jobId }));
            return;
        }
        const statusMatch = url.match(/^\/jobs\/([^/]+)$/);
        if (req.method === 'GET' && statusMatch) {
            const job = jobs.get(statusMatch[1]);
            res.writeHead(job ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(job ? { job_id: statusMatch[1], ...job } : { error: 'job not found' }));
            return;
        }
        const resultMatch = url.match(/^\/jobs\/([^/]+)\/result$/);
        if (req.method === 'GET' && resultMatch) {
            const format = query.get('format') || 'gif';
            const map = {
                gif: [GIF_BYTES, 'image/gif'],
                mp4: [MP4_BYTES, 'video/mp4'],
                webp: [WEBP_BYTES, 'image/webp']
            };
            const [buf, type] = map[format] || map.gif;
            res.writeHead(200, { 'Content-Type': type });
            res.end(buf);
            return;
        }
        res.writeHead(404);
        res.end();
    });

    const port = server.address().port;
    const base = 'http://127.0.0.1:' + port;
    clearLocalWorkerHealthCache();

    await assert.rejects(
        () => animateBufferWithLocalWorker({ getSecureConfig: () => ({}) }, TINY_PNG, { motionPrompt: 'x' }),
        (err) => {
            assert.strictEqual(err.code, 'LOCAL_WORKER_OFFLINE');
            return true;
        }
    );
    assert.strictEqual(hits.jobs, 0);

    clearLocalWorkerHealthCache();
    await assert.rejects(
        () => animateBufferWithLocalWorker(resources(base, 'test-key'), TINY_PNG, {}),
        (err) => {
            assert.match(err.message, /motionPrompt is required/);
            return true;
        }
    );

    clearLocalWorkerHealthCache();
    const animated = await animateBufferWithLocalWorker(resources(base, 'test-key'), TINY_PNG, {
        motionPrompt: 'hair sways in the wind',
        frames: 24,
        fps: 12,
        loop: false,
        backend: 'wan',
        pollMs: 20
    });
    assert.strictEqual(animated.jobId, 'job-animate-1');
    assert.strictEqual(animated.backend, 'wan');
    assert.strictEqual(animated.frames, 24);
    assert.strictEqual(animated.fps, 12);
    assert.strictEqual(animated.loop, false);
    assert.ok(animated.buffers.gif.equals(GIF_BYTES));
    assert.ok(animated.buffers.mp4.equals(MP4_BYTES));
    assert.ok(animated.buffers.webp.equals(WEBP_BYTES));
    assert.strictEqual(hits.jobs, 1);

    // Unknown backend falls back to the default rather than rejecting.
    clearLocalWorkerHealthCache();
    const defaulted = await animateBufferWithLocalWorker(resources(base, 'test-key'), TINY_PNG, {
        motionPrompt: 'blink slowly',
        backend: 'not-a-real-backend',
        pollMs: 20
    });
    assert.strictEqual(defaulted.backend, 'animatediff');

    // Full stack: animateImageWebSocket saves gif/mp4/webp and a DB-only receipt.
    const saved = [];
    const receipts = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruiko-animate-'));
    const images = path.join(root, 'images');
    fs.mkdirSync(images);
    fs.writeFileSync(path.join(images, 'shot.png'), TINY_PNG);
    const PngMetadata = require('../modules/pngMetadata');
    const { animateImageWebSocket } = require('../modules/imageAnimation');
    const gr = {
        getSecureConfig() {
            return { url: base, key: 'test-key' };
        },
        getPath(name) {
            if (name === 'images') return images;
            throw new Error('path ' + name);
        },
        getPngMetadata() {
            return new PngMetadata();
        },
        getWorkspaceManager() {
            return {
                getActiveWorkspace() { return 'default'; },
                addToWorkspaceArray(kind, filename) { saved.push(filename); }
            };
        },
        getMetadataDatabase() {
            return {
                addReceiptMetadata: async (filename, imagesDir, receiptData) => {
                    receipts.push({ filename, receiptData });
                    return { filename, receipt: receiptData ? [receiptData] : [] };
                },
                setImageBlurhash: async () => {}
            };
        }
    };

    clearLocalWorkerHealthCache();
    const result = await animateImageWebSocket(gr, 'shot.png', 'desk', 'admin', 'sess', {
        motionPrompt: 'hair sways in the wind',
        frames: 16,
        fps: 8,
        loop: true,
        backend: 'animatediff'
    });
    assert.strictEqual(result.jobId, 'job-animate-1');
    assert.ok(result.filename.startsWith('shot_animate_'));
    assert.ok(result.filename.endsWith('.gif'));
    assert.ok(saved.indexOf(result.filename) !== -1, 'gif filename added to workspace');
    assert.strictEqual(receipts.length, 1);
    assert.strictEqual(receipts[0].filename, result.filename);
    assert.strictEqual(receipts[0].receiptData.motion_prompt, 'hair sways in the wind');
    assert.strictEqual(receipts[0].receiptData.animate_backend, 'animatediff');
    assert.strictEqual(receipts[0].receiptData.local_job_id, 'job-animate-1');
    assert.deepStrictEqual(Object.keys(receipts[0].receiptData.formats).sort(), ['gif', 'mp4', 'webp']);

    const gifPath = path.join(images, result.filename);
    assert.ok(fs.existsSync(gifPath));
    assert.ok(fs.readFileSync(gifPath).equals(GIF_BYTES));
    const mp4Path = path.join(images, result.filename.replace(/\.gif$/, '.mp4'));
    assert.ok(fs.existsSync(mp4Path));
    assert.ok(fs.readFileSync(mp4Path).equals(MP4_BYTES));
    const webpPath = path.join(images, result.filename.replace(/\.gif$/, '.webp'));
    assert.ok(fs.existsSync(webpPath));

    // Read-only users are blocked before any Ruiko call.
    await assert.rejects(
        () => animateImageWebSocket(gr, 'shot.png', 'desk', 'readonly', 'sess', { motionPrompt: 'x' }),
        /read-only/i
    );

    fs.rmSync(root, { recursive: true, force: true });

    await new Promise((resolve) => server.close(resolve));
    console.log('test-local-animate-worker: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
