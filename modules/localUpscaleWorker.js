/**
 * Local (Ruiko) upscaler client.
 *
 * secure.config.json (gitignored, never commit):
 *   localWorker.url  base URL of the worker, no trailing path (http://host:8188)
 *   localWorker.key  bearer token (RUIKO_WORKER_KEY / worker.key on Ruiko)
 *
 * Local upscales do not call NovelAI and do not spend Anlas.
 */

const HEALTH_TTL_MS = 15000;

const LOCAL_UPSCALE_MODELS = [
    { id: 'RealESRGAN_x4plus', name: 'RealESRGAN x4plus', scale: 4 },
    { id: 'RealESRGAN_x4plus_anime_6B', name: 'RealESRGAN x4plus anime 6B', scale: 4 },
    { id: '4x-UltraSharp', name: '4x-UltraSharp', scale: 4 }
];

const DEFAULT_LOCAL_MODEL = 'RealESRGAN_x4plus';

let healthCache = null;

function normalizeUpscalerName(value) {
    const name = String(value || '').trim().toLowerCase();
    if (name === 'local' || name === 'ruiko') return 'local';
    if (name === 'nai' || name === 'novelai') return 'novelai';
    if (name === 'esrgan') return 'esrgan';
    return name || '';
}

function isLocalUpscaler(value) {
    return normalizeUpscalerName(value) === 'local';
}

function readLocalWorkerConfig(globalResources) {
    const secure = globalResources && typeof globalResources.getSecureConfig === 'function'
        ? (globalResources.getSecureConfig({ path: 'localWorker' }) || {})
        : {};
    const url = String(secure.url || '').trim().replace(/\/+$/, '');
    const key = String(secure.key || '').trim();
    return { url, key };
}

function localWorkerOfflineError(detail) {
    const extra = detail ? String(detail) : 'Set localWorker.url and localWorker.key in secure.config.json.';
    const error = new Error(
        'Local (Ruiko) upscaler is offline or not configured. ' + extra
        + ' Retry with backend="nai" to use NovelAI upscale (spends Anlas). This request did not spend Anlas.'
    );
    error.code = 'LOCAL_WORKER_OFFLINE';
    error.fallbackBackend = 'nai';
    return error;
}

function localWorkerJobError(jobId, detail) {
    const error = new Error('Local (Ruiko) upscale job ' + jobId + ' failed: ' + (detail || 'unknown error'));
    error.code = 'LOCAL_WORKER_JOB_FAILED';
    error.jobId = jobId;
    return error;
}

function clearLocalWorkerHealthCache() {
    healthCache = null;
}

function authHeaders(key) {
    return {
        Authorization: 'Bearer ' + key,
        Accept: 'application/json'
    };
}

async function fetchJson(url, options, timeoutMs) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs || 8000)
    });
    const text = await response.text();
    let body = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch (_) {
            body = null;
        }
    }
    return { response, body, text };
}

async function checkLocalWorkerHealth(globalResources, opts = {}) {
    const cfg = readLocalWorkerConfig(globalResources);
    if (!cfg.url || !cfg.key) {
        return {
            online: false,
            configured: false,
            models: LOCAL_UPSCALE_MODELS.slice(),
            reason: 'localWorker.url and localWorker.key are not set in secure.config.json.'
        };
    }
    const now = Date.now();
    if (!opts.force && healthCache && healthCache.url === cfg.url && (now - healthCache.at) < HEALTH_TTL_MS) {
        return healthCache.value;
    }
    let value;
    try {
        const { response, body } = await fetchJson(cfg.url + '/health', {
            method: 'GET',
            headers: authHeaders(cfg.key)
        }, opts.timeoutMs || 4000);
        if (!response.ok || !body || body.auth !== 'ok') {
            value = {
                online: false,
                configured: true,
                models: LOCAL_UPSCALE_MODELS.slice(),
                reason: 'Ruiko health check failed (HTTP ' + response.status + ').'
            };
        } else {
            value = {
                online: true,
                configured: true,
                version: body.version || null,
                gpu: body.gpu || null,
                queueLength: body.queue_length,
                loadedModels: body.loaded_models || [],
                models: LOCAL_UPSCALE_MODELS.slice(),
                reason: null
            };
        }
    } catch (err) {
        value = {
            online: false,
            configured: true,
            models: LOCAL_UPSCALE_MODELS.slice(),
            reason: err && err.message ? err.message : 'Ruiko is unreachable.'
        };
    }
    if (value.online) {
        try {
            const listed = await listLocalWorkerModels(globalResources, { timeoutMs: opts.timeoutMs || 4000 });
            if (listed && listed.length) value.models = listed;
        } catch (_) {
            value.models = LOCAL_UPSCALE_MODELS.slice();
        }
    }
    healthCache = { url: cfg.url, at: now, value };
    return value;
}

async function assertLocalWorkerOnline(globalResources) {
    const health = await checkLocalWorkerHealth(globalResources);
    if (!health.online) {
        throw localWorkerOfflineError(health.reason);
    }
    return health;
}

async function listLocalWorkerModels(globalResources, opts = {}) {
    const cfg = readLocalWorkerConfig(globalResources);
    if (!cfg.url || !cfg.key) return LOCAL_UPSCALE_MODELS.slice();
    const { response, body } = await fetchJson(cfg.url + '/models', {
        method: 'GET',
        headers: authHeaders(cfg.key)
    }, opts.timeoutMs || 4000);
    if (!response.ok || !body || !Array.isArray(body.models)) {
        throw localWorkerOfflineError('GET /models failed (HTTP ' + response.status + ').');
    }
    return body.models.map((row) => ({
        id: row.id,
        name: row.name || row.id,
        scale: row.scale || 4
    }));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upscaleBufferWithLocalWorker(globalResources, imageBuffer, options = {}) {
    const cfg = readLocalWorkerConfig(globalResources);
    if (!cfg.url || !cfg.key) {
        throw localWorkerOfflineError('localWorker.url and localWorker.key are not set in secure.config.json.');
    }
    const health = await checkLocalWorkerHealth(globalResources);
    if (!health.online) {
        throw localWorkerOfflineError(health.reason);
    }
    const model = options.model || DEFAULT_LOCAL_MODEL;
    const scale = Number(options.scale) === 2 ? 2 : 4;
    let posted;
    try {
        posted = await fetchJson(cfg.url + '/jobs', {
            method: 'POST',
            headers: {
                ...authHeaders(cfg.key),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: Buffer.from(imageBuffer).toString('base64'),
                model,
                scale
            })
        }, 20000);
    } catch (err) {
        clearLocalWorkerHealthCache();
        throw localWorkerOfflineError(err && err.message ? err.message : 'POST /jobs failed.');
    }
    if (!posted.response.ok || !posted.body || !posted.body.job_id) {
        const detail = (posted.body && posted.body.error) || ('HTTP ' + posted.response.status);
        if (posted.response.status >= 500 || posted.response.status === 401 || posted.response.status === 503) {
            clearLocalWorkerHealthCache();
            throw localWorkerOfflineError(detail);
        }
        const error = new Error('Local (Ruiko) upscaler rejected the image: ' + detail);
        error.code = 'LOCAL_WORKER_REJECTED';
        throw error;
    }
    const jobId = posted.body.job_id;
    const deadline = Date.now() + (options.timeoutMs || 15 * 60 * 1000);
    let last = null;
    while (Date.now() < deadline) {
        await sleep(options.pollMs || 400);
        let status;
        try {
            status = await fetchJson(cfg.url + '/jobs/' + jobId, {
                method: 'GET',
                headers: authHeaders(cfg.key)
            }, 8000);
        } catch (err) {
            last = err;
            continue;
        }
        if (!status.response.ok || !status.body) {
            last = new Error('status HTTP ' + status.response.status);
            continue;
        }
        last = status.body;
        if (typeof options.onProgress === 'function') {
            const progress = Number(status.body.progress);
            options.onProgress(Number.isFinite(progress) ? progress : 0, status.body.status, jobId);
        }
        if (status.body.status === 'completed') break;
        if (status.body.status === 'failed') {
            throw localWorkerJobError(jobId, status.body.error);
        }
    }
    if (!last || last.status !== 'completed') {
        const error = localWorkerOfflineError('job ' + jobId + ' did not finish.');
        error.jobId = jobId;
        throw error;
    }
    const result = await fetch(cfg.url + '/jobs/' + jobId + '/result', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + cfg.key, Accept: 'image/png' },
        signal: AbortSignal.timeout(60000)
    });
    if (!result.ok) {
        throw localWorkerJobError(jobId, 'result HTTP ' + result.status);
    }
    const bytes = Buffer.from(await result.arrayBuffer());
    return { buffer: bytes, jobId, model, scale };
}

module.exports = {
    LOCAL_UPSCALE_MODELS,
    DEFAULT_LOCAL_MODEL,
    HEALTH_TTL_MS,
    normalizeUpscalerName,
    isLocalUpscaler,
    readLocalWorkerConfig,
    localWorkerOfflineError,
    clearLocalWorkerHealthCache,
    checkLocalWorkerHealth,
    assertLocalWorkerOnline,
    listLocalWorkerModels,
    upscaleBufferWithLocalWorker
};
