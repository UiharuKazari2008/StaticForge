'use strict';

/**
 * Multi-worker routing: health, priority, scale, and animate capability.
 * In-process mocks. No GPU, no NovelAI, no Anlas.
 *
 * Run: node scripts/test-multi-upscale-worker.js
 */

const assert = require('assert');
const http = require('http');
const {
    clearLocalWorkerHealthCache,
    readLocalWorkers,
    selectUpscaleTarget,
    selectAnimateWorker,
    checkLocalWorkerHealth,
    upscaleBufferWithLocalWorker,
    animateBufferWithLocalWorker,
    G10_FAST_MODEL,
    G10_SLOW_MODEL
} = require('../modules/localUpscaleWorker');

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

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

function worker(id, extra) {
    return Object.assign({
        id,
        url: 'http://127.0.0.1/' + id,
        key: id + '-key',
        online: true,
        maxScale: 4,
        priority: 0,
        models: [],
        jobTypes: ['upscale']
    }, extra);
}

function resources(workers, legacy) {
    return {
        getSecureConfig({ path } = {}) {
            if (path === 'localWorkers') return workers;
            if (path === 'localWorker') return legacy;
            return undefined;
        }
    };
}

async function main() {
    const ruiko = worker('ruiko', {
        priority: 20,
        maxScale: 8,
        models: [
            { id: 'RealESRGAN_x4plus', scale: 4 },
            { id: '4x-UltraSharp', scale: 4 }
        ],
        jobTypes: ['upscale', 'animate'],
        animateBackends: ['loop', 'wan', 'ltx']
    });
    const g10 = worker('g10', {
        priority: 10,
        maxScale: 4,
        models: [
            { id: 'realesr-animevideov3', scales: [2, 4], speed: 'fast' },
            { id: 'realesrgan-x4plus-anime', scales: [4], speed: 'slow' },
            { id: 'realesrgan-x4plus', scales: [4], enabled: false }
        ]
    });

    const fast4 = selectUpscaleTarget([ruiko, g10], { scale: 4, speed: 'fast' });
    assert.strictEqual(fast4.worker.id, 'ruiko');
    const fast2 = selectUpscaleTarget([ruiko, g10], { scale: 2, speed: 'fast' });
    assert.strictEqual(fast2.worker.id, 'ruiko');
    const slow4 = selectUpscaleTarget([ruiko, g10], { scale: 4, speed: 'slow' });
    assert.strictEqual(slow4.worker.id, 'g10');
    assert.strictEqual(slow4.model, G10_SLOW_MODEL);
    const slow2 = selectUpscaleTarget([ruiko, g10], { scale: 2, speed: 'slow' });
    assert.strictEqual(slow2.worker.id, 'g10');
    assert.strictEqual(slow2.model, G10_FAST_MODEL);
    const slow8 = selectUpscaleTarget([ruiko, g10], { scale: 8, speed: 'slow' });
    assert.strictEqual(slow8.worker.id, 'ruiko');
    const named = selectUpscaleTarget([ruiko, g10], { scale: 2, model: '4x-UltraSharp' });
    assert.strictEqual(named.worker.id, 'ruiko');
    assert.strictEqual(named.model, '4x-UltraSharp');

    const g10Down = Object.assign({}, g10, { online: false });
    assert.strictEqual(selectUpscaleTarget([ruiko, g10Down], { scale: 4, speed: 'fast' }).worker.id, 'ruiko');
    const ruikoDown = Object.assign({}, ruiko, { online: false });
    const fastG10 = selectUpscaleTarget([ruikoDown, g10], { scale: 4, speed: 'fast' });
    assert.strictEqual(fastG10.worker.id, 'g10');
    assert.strictEqual(fastG10.model, G10_FAST_MODEL);
    assert.strictEqual(selectUpscaleTarget([ruikoDown, g10Down], { scale: 4, speed: 'fast' }), null);
    assert.strictEqual(selectAnimateWorker([ruiko, g10]).id, 'ruiko');
    assert.strictEqual(selectAnimateWorker([ruikoDown, g10]), null);

    const legacy = readLocalWorkers({
        getSecureConfig({ path } = {}) {
            if (path === 'localWorker') return { url: 'http://ruiko:8188', key: 'legacy-key' };
            return undefined;
        }
    });
    assert.strictEqual(legacy.length, 1);
    assert.strictEqual(legacy[0].id, 'ruiko');
    assert.strictEqual(legacy[0].url, 'http://ruiko:8188');

    const hits = { ruikoJobs: 0, g10Jobs: 0 };
    const posted = { ruiko: null, g10: null };
    function mock(role, key) {
        return async (req, res) => {
            const url = (req.url || '').split('?')[0];
            const auth = req.headers.authorization || '';
            if (url === '/health') {
                const ok = auth === 'Bearer ' + key;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(ok ? {
                    ok: true,
                    auth: 'ok',
                    gpu: role,
                    queue_length: 0,
                    job_types: role === 'ruiko' ? ['upscale', 'animate'] : ['upscale'],
                    animate_backends: role === 'ruiko' ? ['loop', 'ltx', 'wan'] : []
                } : { ok: true, auth: 'required' }));
                return;
            }
            if (auth !== 'Bearer ' + key) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'unauthorized' }));
                return;
            }
            if (url === '/models') {
                const models = role === 'ruiko'
                    ? [{ id: 'RealESRGAN_x4plus', name: 'RealESRGAN x4plus', scale: 4 }, { id: '4x-UltraSharp', name: '4x-UltraSharp', scale: 4 }]
                    : [
                        { id: 'realesr-animevideov3', name: 'realesr-animevideov3', scale: 4, scales: [2, 4], speed: 'fast', enabled: true },
                        { id: 'realesrgan-x4plus-anime', name: 'realesrgan-x4plus-anime', scale: 4, scales: [4], speed: 'slow', enabled: true }
                    ];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models }));
                return;
            }
            if (req.method === 'POST' && url === '/jobs') {
                const payload = JSON.parse((await readBody(req)).toString('utf8'));
                if (role === 'ruiko') {
                    hits.ruikoJobs += 1;
                    posted.ruiko = payload;
                } else {
                    hits.g10Jobs += 1;
                    posted.g10 = payload;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ job_id: role + '-job' }));
                return;
            }
            const statusMatch = url.match(/^\/jobs\/([^/]+)$/);
            if (req.method === 'GET' && statusMatch) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ job_id: statusMatch[1], status: 'completed', progress: 100, error: null }));
                return;
            }
            if (req.method === 'GET' && /\/result$/.test(url)) {
                const format = (req.url.split('format=')[1] || 'png').split('&')[0];
                if (format === 'gif' || format === 'mp4' || format === 'webp' || format === 'webm') {
                    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                    res.end(Buffer.from(format));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(TINY_PNG);
                return;
            }
            res.writeHead(404);
            res.end();
        };
    }

    const ruikoServer = await listen(mock('ruiko', 'ruiko-key'));
    const g10Server = await listen(mock('g10', 'g10-key'));
    const ruikoUrl = 'http://127.0.0.1:' + ruikoServer.address().port;
    const g10Url = 'http://127.0.0.1:' + g10Server.address().port;
    const gr = resources([
        {
            id: 'ruiko',
            url: ruikoUrl,
            key: 'ruiko-key',
            models: ['RealESRGAN_x4plus', '4x-UltraSharp'],
            maxScale: 8,
            priority: 20
        },
        {
            id: 'g10',
            url: g10Url,
            key: 'g10-key',
            models: ['realesr-animevideov3', 'realesrgan-x4plus-anime'],
            maxScale: 4,
            priority: 10
        }
    ]);

    try {
        clearLocalWorkerHealthCache();
        const health = await checkLocalWorkerHealth(gr);
        const blob = JSON.stringify(health);
        assert.strictEqual(health.online, true);
        assert.ok(blob.indexOf('ruiko-key') === -1, 'ruiko key leaked');
        assert.ok(blob.indexOf('g10-key') === -1, 'g10 key leaked');
        assert.strictEqual(health.workers.length, 2);
        assert.ok(health.workers.every((row) => !row.key && !row.url));

        clearLocalWorkerHealthCache();
        const fast = await upscaleBufferWithLocalWorker(gr, TINY_PNG, { scale: 4, speed: 'fast', pollMs: 10 });
        assert.strictEqual(fast.workerId, 'ruiko');
        assert.strictEqual(hits.ruikoJobs, 1);
        assert.strictEqual(hits.g10Jobs, 0);

        const slow = await upscaleBufferWithLocalWorker(gr, TINY_PNG, { scale: 4, speed: 'slow', pollMs: 10 });
        assert.strictEqual(slow.workerId, 'g10');
        assert.strictEqual(slow.model, G10_SLOW_MODEL);
        assert.strictEqual(posted.g10.model, G10_SLOW_MODEL);
        assert.strictEqual(hits.g10Jobs, 1);

        const beyond = await upscaleBufferWithLocalWorker(gr, TINY_PNG, { scale: 8, speed: 'slow', pollMs: 10 });
        assert.strictEqual(beyond.workerId, 'ruiko');
        assert.strictEqual(posted.ruiko.scale, 8);

        const beforeG10 = hits.g10Jobs;
        const animated = await animateBufferWithLocalWorker(gr, TINY_PNG, {
            motionPrompt: 'blink',
            backend: 'ltx',
            pollMs: 10
        });
        assert.strictEqual(animated.workerId, 'ruiko');
        assert.strictEqual(posted.ruiko.type, 'animate');
        assert.strictEqual(hits.g10Jobs, beforeG10, 'animate must not run on G10');
    } finally {
        await new Promise((resolve) => ruikoServer.close(resolve));
        await new Promise((resolve) => g10Server.close(resolve));
    }

    console.log('test-multi-upscale-worker: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
