'use strict';

/**
 * G10 RealESRGAN worker: auth, catalog, and vkQueueSubmit failure.
 * The Vulkan binary is not run. No GPU.
 *
 * Run: node scripts/test-g10-upscaler.js
 */

const assert = require('assert');
const fs = require('fs');
const {
    gpuFailureFromOutput,
    catalog,
    createWorkerServer,
    GPU_FAILURE
} = require('../services/g10-upscaler/server');

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

async function request(port, method, path, { key, json } = {}) {
    const res = await fetch('http://127.0.0.1:' + port + path, {
        method,
        headers: Object.assign(
            key ? { Authorization: 'Bearer ' + key } : {},
            json ? { 'Content-Type': 'application/json' } : {}
        ),
        body: json ? JSON.stringify(json) : undefined
    });
    const type = res.headers.get('content-type') || '';
    if (type.indexOf('image/') === 0) {
        return { status: res.status, body: Buffer.from(await res.arrayBuffer()), json: null };
    }
    const text = await res.text();
    let parsed = null;
    if (text) {
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
    }
    return { status: res.status, body: text, json: parsed };
}

async function main() {
    assert.strictEqual(gpuFailureFromOutput('tile 0\nvkQueueSubmit failed\n'), GPU_FAILURE);
    assert.strictEqual(gpuFailureFromOutput('VKQUEUESUBMIT FAILED'), GPU_FAILURE);
    assert.strictEqual(gpuFailureFromOutput('ok'), '');

    const rows = catalog(false);
    const plus = rows.find((row) => row.id === 'realesrgan-x4plus');
    assert.strictEqual(plus.enabled, false);
    assert.strictEqual(plus.optional, true);
    assert.strictEqual(catalog(true).find((row) => row.id === 'realesrgan-x4plus').enabled, true);
    assert.ok(rows.find((row) => row.id === 'realesr-animevideov3').scales.indexOf(2) !== -1);
    assert.deepStrictEqual(rows.find((row) => row.id === 'realesrgan-x4plus-anime').scales, [4]);

    const calls = [];
    let failGpu = false;
    const listener = await createWorkerServer({
        key: 'g10-test-key',
        port: 0,
        enableX4plus: false,
        gpu: 'AMD Radeon Vega 8',
        runBinary: async (bin, args) => {
            calls.push(args);
            const out = args[args.indexOf('-o') + 1];
            fs.writeFileSync(out, TINY_PNG);
            if (failGpu) return { code: 0, output: 'vkQueueSubmit failed\n' };
            return { code: 0, output: '' };
        }
    });
    assert.strictEqual(listener.host, '127.0.0.1');

    try {
        const openHealth = await request(listener.port, 'GET', '/health');
        assert.strictEqual(openHealth.json.auth, 'required');
        assert.ok(!openHealth.json.gpu);

        const health = await request(listener.port, 'GET', '/health', { key: 'g10-test-key' });
        assert.strictEqual(health.json.auth, 'ok');
        assert.strictEqual(health.json.gpu, 'AMD Radeon Vega 8');
        assert.deepStrictEqual(health.json.job_types, ['upscale']);

        const denied = await request(listener.port, 'GET', '/models');
        assert.strictEqual(denied.status, 401);

        const models = await request(listener.port, 'GET', '/models', { key: 'g10-test-key' });
        const listedPlus = models.json.models.find((row) => row.id === 'realesrgan-x4plus');
        assert.strictEqual(listedPlus.enabled, false);

        const rejected = await request(listener.port, 'POST', '/jobs', {
            key: 'g10-test-key',
            json: { image: TINY_PNG.toString('base64'), model: 'RealESRGAN_x4plus', scale: 4 }
        });
        assert.strictEqual(rejected.status, 400);
        assert.strictEqual(calls.length, 0, 'disabled model must not start the binary');

        const posted = await request(listener.port, 'POST', '/jobs', {
            key: 'g10-test-key',
            json: { image: TINY_PNG.toString('base64'), model: 'realesr-animevideov3', scale: 2 }
        });
        assert.strictEqual(posted.status, 200);
        assert.ok(posted.json.job_id);
        assert.ok(calls[0].indexOf('realesr-animevideov3') !== -1);
        assert.ok(calls[0].indexOf('2') !== -1);

        let status = null;
        for (let i = 0; i < 20; i += 1) {
            status = await request(listener.port, 'GET', '/jobs/' + posted.json.job_id, { key: 'g10-test-key' });
            if (status.json && status.json.status === 'completed') break;
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
        assert.strictEqual(status.json.status, 'completed');
        const result = await request(listener.port, 'GET', '/jobs/' + posted.json.job_id + '/result', { key: 'g10-test-key' });
        assert.strictEqual(result.status, 200);
        assert.ok(Buffer.isBuffer(result.body));
        assert.ok(result.body.equals(TINY_PNG));

        failGpu = true;
        const gpuJob = await request(listener.port, 'POST', '/jobs', {
            key: 'g10-test-key',
            json: { image: TINY_PNG.toString('base64'), model: 'realesrgan-x4plus-anime', scale: 4 }
        });
        let failed = null;
        for (let i = 0; i < 20; i += 1) {
            failed = await request(listener.port, 'GET', '/jobs/' + gpuJob.json.job_id, { key: 'g10-test-key' });
            if (failed.json && failed.json.status === 'failed') break;
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
        assert.strictEqual(failed.json.status, 'failed');
        assert.ok(String(failed.json.error).indexOf('vkQueueSubmit failed') !== -1);
        const hidden = await request(listener.port, 'GET', '/jobs/' + gpuJob.json.job_id + '/result', { key: 'g10-test-key' });
        assert.notStrictEqual(hidden.status, 200);
    } finally {
        await listener.close();
    }

    console.log('test-g10-upscaler: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
