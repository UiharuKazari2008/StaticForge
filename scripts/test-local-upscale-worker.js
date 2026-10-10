'use strict';

/**
 * Local Ruiko upscaler client against an in-process mock worker.
 * No GPU, no NovelAI, no Anlas.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { LOCAL_UPSCALE_MODELS, clearLocalWorkerHealthCache, checkLocalWorkerHealth, upscaleBufferWithLocalWorker } = require('../modules/localUpscaleWorker');

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);
const OUT_PNG = TINY_PNG;

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
    const hits = { health: 0, models: 0, jobs: 0 };
    const jobs = new Map();
    const server = await listen(async (req, res) => {
        const url = (req.url || '').split('?')[0];
        const auth = req.headers.authorization || '';
        if (url === '/health') {
            hits.health += 1;
            const body = auth === 'Bearer test-key'
                ? { ok: true, auth: 'ok', version: '1.0.0', gpu: 'Test GPU', vram_total_mb: 8192, vram_free_mb: 7000, queue_length: jobs.size, loaded_models: ['RealESRGAN_x4plus'] }
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
        if (url === '/models') {
            hits.models += 1;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                models: LOCAL_UPSCALE_MODELS.map((row) => ({ id: row.id, name: row.name, scale: 4 }))
            }));
            return;
        }
        if (req.method === 'POST' && url === '/jobs') {
            hits.jobs += 1;
            const payload = JSON.parse((await readBody(req)).toString('utf8'));
            assert.strictEqual(payload.model, '4x-UltraSharp');
            assert.strictEqual(payload.scale, 2);
            assert.ok(payload.image && payload.image.length > 20);
            const jobId = 'job-test-1';
            jobs.set(jobId, { status: 'completed', progress: 100, error: null, model: payload.model, scale: payload.scale });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ job_id: jobId }));
            return;
        }
        const statusMatch = url.match(/^\/jobs\/([^/]+)$/);
        if (req.method === 'GET' && statusMatch) {
            const job = jobs.get(statusMatch[1]);
            res.writeHead(job ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(job
                ? { job_id: statusMatch[1], ...job }
                : { error: 'job not found' }));
            return;
        }
        const resultMatch = url.match(/^\/jobs\/([^/]+)\/result$/);
        if (req.method === 'GET' && resultMatch) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(OUT_PNG);
            return;
        }
        res.writeHead(404);
        res.end();
    });

    const port = server.address().port;
    const base = 'http://127.0.0.1:' + port;
    clearLocalWorkerHealthCache();

    await assert.rejects(
        () => upscaleBufferWithLocalWorker({ getSecureConfig: () => ({}) }, TINY_PNG, { model: '4x-UltraSharp' }),
        (err) => {
            assert.strictEqual(err.code, 'LOCAL_WORKER_OFFLINE');
            assert.match(err.message, /backend="nai"/);
            assert.match(err.message, /did not spend Anlas/);
            return true;
        }
    );
    assert.strictEqual(hits.jobs, 0);

    clearLocalWorkerHealthCache();
    await assert.rejects(
        () => upscaleBufferWithLocalWorker(resources('http://127.0.0.1:1', 'test-key'), TINY_PNG, {}),
        (err) => {
            assert.strictEqual(err.code, 'LOCAL_WORKER_OFFLINE');
            assert.match(err.message, /backend="nai"/);
            return true;
        }
    );

    clearLocalWorkerHealthCache();
    const first = await checkLocalWorkerHealth(resources(base, 'test-key'));
    const second = await checkLocalWorkerHealth(resources(base, 'test-key'));
    assert.strictEqual(first.online, true);
    assert.strictEqual(first.gpu, 'Test GPU');
    assert.strictEqual(first.models.length, 3);
    assert.strictEqual(second.online, true);
    assert.strictEqual(hits.health, 1, 'health is cached');
    assert.strictEqual(hits.models, 1);

    const upscaled = await upscaleBufferWithLocalWorker(resources(base, 'test-key'), TINY_PNG, {
        model: '4x-UltraSharp',
        scale: 2,
        pollMs: 20
    });
    assert.strictEqual(upscaled.jobId, 'job-test-1');
    assert.strictEqual(upscaled.model, '4x-UltraSharp');
    assert.strictEqual(upscaled.scale, 2);
    assert.ok(upscaled.buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    assert.strictEqual(hits.jobs, 1);

    const saved = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruiko-upscale-'));
    const images = path.join(root, 'images');
    const previews = path.join(root, 'previews');
    fs.mkdirSync(images);
    fs.mkdirSync(previews);
    fs.writeFileSync(path.join(images, 'shot.png'), TINY_PNG);
    fs.writeFileSync(path.join(previews, 'shot.webp'), Buffer.from('preview'));
    const PngMetadata = require('../modules/pngMetadata');
    const { upscaleImageWebSocket } = require('../modules/imageUpscaling');
    const gr = {
        getSecureConfig() {
            return { url: base, key: 'test-key' };
        },
        getPath(name) {
            if (name === 'images') return images;
            if (name === 'previews') return previews;
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
                getImageMetadata: async () => null,
                setImageBlurhash: async () => {}
            };
        }
    };
    const result = await upscaleImageWebSocket(gr, 'shot.png', 'desk', 'admin', 'sess', 'local', 2, null, null, 'req', {
        model: '4x-UltraSharp'
    });
    assert.strictEqual(result.filename, 'shot_upscaled.png');
    assert.strictEqual(result.jobId, 'job-test-1');
    assert.ok(saved.indexOf('shot_upscaled.png') !== -1);
    const written = fs.readFileSync(path.join(images, 'shot_upscaled.png'));
    const meta = new PngMetadata().readMetadata(written);
    const comment = JSON.parse(meta.tEXt.Comment);
    assert.strictEqual(comment.forge_data.generation_type, 'upscaled');
    assert.strictEqual(comment.forge_data.upscaler_provider, 'local');
    assert.strictEqual(comment.forge_data.upscaler_model, '4x-UltraSharp');
    assert.strictEqual(comment.forge_data.local_job_id, 'job-test-1');
    fs.rmSync(root, { recursive: true, force: true });

    await new Promise((resolve) => server.close(resolve));
    console.log('test-local-upscale-worker: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
