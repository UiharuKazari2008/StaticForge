/**
 * Local worker client: upscale and animate.
 *
 * secure.config.json (gitignored, never commit):
 *   localWorkers: [{ id, url, key, models, maxScale, priority }, ...]
 *   localWorker:  { url, key }   legacy single Ruiko entry, still accepted
 *
 * Fast picks the healthy worker with the highest priority that can do the scale
 * (Ruiko or G10). Slow prefers G10 up to its maxScale, then Ruiko.
 * Animate jobs go only to workers whose /health lists animate.
 * Neither path calls NovelAI or spends Anlas.
 */

const HEALTH_TTL_MS = 15000;

const LOCAL_UPSCALE_MODELS = [
    { id: 'RealESRGAN_x4plus', name: 'RealESRGAN x4plus', scale: 4 },
    { id: 'RealESRGAN_x4plus_anime_6B', name: 'RealESRGAN x4plus anime 6B', scale: 4 },
    { id: '4x-UltraSharp', name: '4x-UltraSharp', scale: 4 }
];

const DEFAULT_LOCAL_MODEL = 'RealESRGAN_x4plus';
const G10_FAST_MODEL = 'realesr-animevideov3';
const G10_SLOW_MODEL = 'realesrgan-x4plus-anime';

const LOCAL_ANIMATE_BACKENDS = [
    { id: 'loop', name: 'AnimateDiff Loop (SD1.5)' },
    { id: 'wan', name: 'Wan 2.1 I2V 14B (480p)' },
    { id: 'ltx', name: 'LTX-Video I2V' }
];

// ltx is the best *working* true image-to-video mode on Ruiko's 8 GB card;
// wan is real I2V too but ran 2.5+ hours without finishing in the bakeoff.
const DEFAULT_ANIMATE_BACKEND = 'ltx';
const DEFAULT_ANIMATE_FRAMES = 16;
const DEFAULT_ANIMATE_FPS = 8;
const ANIMATE_RESULT_FORMATS = ['webm', 'gif', 'mp4', 'webp'];
const ANIMATE_OPTIONAL_FORMATS = new Set(['webm']); // older workers lack webm

const healthCache = new Map();

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

function readSecurePath(globalResources, path) {
    if (!globalResources || typeof globalResources.getSecureConfig !== 'function') return undefined;
    try {
        return globalResources.getSecureConfig({ path });
    } catch (_) {
        return undefined;
    }
}

function normalizeModels(models) {
    if (!Array.isArray(models)) return [];
    const out = [];
    models.forEach((row) => {
        if (typeof row === 'string') {
            const id = row.trim();
            if (id) out.push({ id, name: id, enabled: true });
            return;
        }
        if (!row || typeof row !== 'object') return;
        const id = String(row.id || '').trim();
        if (!id) return;
        out.push({
            id,
            name: row.name || id,
            scale: row.scale,
            scales: Array.isArray(row.scales) ? row.scales.map(Number).filter((n) => n > 0) : undefined,
            speed: row.speed || undefined,
            enabled: row.enabled !== false && row.disabled !== true
        });
    });
    return out;
}

function normalizeWorkerEntry(raw, index, usedIds) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const url = String(raw.url || '').trim().replace(/\/+$/, '');
    const key = String(raw.key || '').trim();
    if (!url || !key) return null;
    const models = normalizeModels(raw.models);
    const maxScaleNum = Number(raw.maxScale);
    const priorityNum = Number(raw.priority);
    let id = String(raw.id || raw.name || '').trim();
    if (!id) {
        const looksG10 = models.some((model) => {
            const name = String(model.id).toLowerCase();
            return name.indexOf('animevideov3') !== -1 || name === 'realesrgan-x4plus-anime';
        });
        id = looksG10 ? 'g10' : (index === 0 ? 'ruiko' : ('worker-' + (index + 1)));
    }
    let unique = id;
    let n = 2;
    while (usedIds.has(unique)) {
        unique = id + '-' + n;
        n += 1;
    }
    usedIds.add(unique);
    return {
        id: unique,
        url,
        key,
        models,
        maxScale: Number.isFinite(maxScaleNum) && maxScaleNum > 0 ? maxScaleNum : 4,
        priority: Number.isFinite(priorityNum) ? priorityNum : 0,
        animate: raw.animate === true
    };
}

function readLocalWorkers(globalResources) {
    const listed = readSecurePath(globalResources, 'localWorkers');
    const usedIds = new Set();
    if (Array.isArray(listed)) {
        const normalized = listed
            .map((row, index) => normalizeWorkerEntry(row, index, usedIds))
            .filter(Boolean);
        if (normalized.length) return normalized;
    }
    const single = readSecurePath(globalResources, 'localWorker');
    const one = normalizeWorkerEntry(single && typeof single === 'object' ? Object.assign({ id: single.id || 'ruiko' }, single) : null, 0, usedIds);
    return one ? [one] : [];
}

function readLocalWorkerConfig(globalResources) {
    const workers = readLocalWorkers(globalResources);
    const ruiko = workers.find((worker) => workerRole(worker) === 'ruiko') || workers[0] || null;
    if (!ruiko) return { url: '', key: '' };
    return {
        url: ruiko.url,
        key: ruiko.key,
        id: ruiko.id,
        maxScale: ruiko.maxScale,
        priority: ruiko.priority,
        models: ruiko.models
    };
}

function workerRole(worker) {
    const id = String((worker && (worker.id || worker.name)) || '').trim().toLowerCase();
    if (id === 'g10' || id === 'vega' || id === 'realesrgan') return 'g10';
    if (id === 'ruiko' || id === 'local') return 'ruiko';
    const models = ((worker && worker.models) || []).map((model) => String(model.id || model).toLowerCase());
    if (models.some((name) => name.indexOf('animevideov3') !== -1 || name === 'realesrgan-x4plus-anime')) return 'g10';
    const types = (worker && worker.jobTypes) || [];
    if (types.indexOf('animate') !== -1 || (worker && worker.animate === true)) return 'ruiko';
    return id || 'worker';
}

function workerDisplayName(worker) {
    const role = workerRole(worker);
    if (role === 'g10') return 'G10';
    if (role === 'ruiko') return 'Ruiko';
    return (worker && worker.id) || 'local worker';
}

function modelScales(model, role) {
    if (model && Array.isArray(model.scales) && model.scales.length) {
        return model.scales.map(Number).filter((n) => n > 0);
    }
    if (role === 'g10') {
        const id = String(model && model.id || '').toLowerCase();
        if (id.indexOf('animevideov3') !== -1) return [2, 4];
        return [4];
    }
    return [2, 4];
}

function modelSupportsScale(model, scale, role) {
    if (!model || model.enabled === false) return false;
    return modelScales(model, role).indexOf(scale) !== -1;
}

function workerCanScale(worker, scale) {
    if (!worker || worker.online === false) return false;
    if (!(worker.url && worker.key)) return false;
    if (Number(worker.maxScale) < scale) return false;
    const models = worker.models || [];
    if (!models.length) return true;
    const role = workerRole(worker);
    if (models.some((model) => modelSupportsScale(model, scale, role))) return true;
    // Ruiko's weights are native 4x. Scales inside maxScale are a resize after that, same as scale 2 today.
    return role === 'ruiko' && scale <= Number(worker.maxScale);
}

function workerHasModel(worker, modelId) {
    const want = String(modelId || '').trim().toLowerCase();
    if (!want) return false;
    return (worker.models || []).some((model) => String(model.id || '').toLowerCase() === want && model.enabled !== false);
}

function byPriority(a, b) {
    return (Number(b.priority) - Number(a.priority)) || String(a.id).localeCompare(String(b.id));
}

function pickModel(worker, scale, speed) {
    const role = workerRole(worker);
    const models = (worker.models || []).filter((model) => modelSupportsScale(model, scale, role));
    if (role === 'g10') {
        const prefer = (scale === 2 || speed !== 'slow') ? G10_FAST_MODEL : G10_SLOW_MODEL;
        const match = models.find((model) => String(model.id).toLowerCase() === prefer);
        if (match) return match.id;
        if (speed === 'slow' && scale !== 2) {
            const slow = models.find((model) => model.speed === 'slow');
            if (slow) return slow.id;
        }
    }
    const tagged = models.find((model) => model.speed === speed);
    if (tagged) return tagged.id;
    if (models[0]) return models[0].id;
    if (role === 'g10') return (scale === 2 || speed !== 'slow') ? G10_FAST_MODEL : G10_SLOW_MODEL;
    return DEFAULT_LOCAL_MODEL;
}

function normalizeRequestedScale(value) {
    const n = Number(value);
    if (n === 2 || n === 3 || n === 8) return n;
    return 4;
}

function normalizeUpscaleSpeed(value) {
    const speed = String(value || '').trim().toLowerCase();
    if (speed === 'slow') return 'slow';
    return 'fast';
}

function explicitUpscaleModel(value) {
    const name = String(value || '').trim();
    if (!name) return '';
    if (name === 'local' || name === 'novelai' || name === 'nai' || name === 'esrgan') return '';
    if (name === 'fast' || name === 'slow' || name === 'instant') return '';
    return name;
}

function selectUpscaleTarget(workers, options = {}) {
    const scale = normalizeRequestedScale(options.scale);
    const speed = normalizeUpscaleSpeed(options.speed || options.upscaleSpeed);
    const requestedModel = explicitUpscaleModel(options.model || options.localUpscaleModel);
    let pool = (workers || []).filter((worker) => workerCanScale(worker, scale));
    if (requestedModel) {
        const withModel = pool.filter((worker) => workerHasModel(worker, requestedModel) || !(worker.models && worker.models.length));
        if (withModel.length) pool = withModel;
    }
    pool.sort(byPriority);
    if (!pool.length) return null;
    let chosen = pool[0];
    if (speed === 'slow' && !requestedModel) {
        const g10 = pool.find((worker) => workerRole(worker) === 'g10' && scale <= Number(worker.maxScale));
        if (g10) chosen = g10;
        else chosen = pool.find((worker) => workerRole(worker) === 'ruiko') || pool[0];
    }
    return {
        worker: chosen,
        model: requestedModel || pickModel(chosen, scale, speed),
        scale,
        speed
    };
}

function workerSupportsAnimate(worker) {
    const types = (worker && worker.jobTypes) || [];
    if (types.indexOf('animate') !== -1) return true;
    if (Array.isArray(worker && worker.animateBackends) && worker.animateBackends.length) return true;
    return !!(worker && worker.animate === true && !types.length);
}

function selectAnimateWorker(workers) {
    const pool = (workers || []).filter((worker) => worker && worker.online !== false && worker.url && worker.key && workerSupportsAnimate(worker));
    pool.sort(byPriority);
    return pool[0] || null;
}

function localWorkerOfflineError(detail) {
    const extra = detail ? String(detail) : 'Set localWorkers or localWorker.url and localWorker.key in secure.config.json.';
    const error = new Error(
        'Local upscaler is offline or not configured. ' + extra
        + ' Retry with backend="nai" to use NovelAI upscale (spends Anlas). This request did not spend Anlas.'
    );
    error.code = 'LOCAL_WORKER_OFFLINE';
    error.fallbackBackend = 'nai';
    return error;
}

function localWorkerJobError(jobId, detail) {
    const error = new Error('Local upscale job ' + jobId + ' failed: ' + (detail || 'unknown error'));
    error.code = 'LOCAL_WORKER_JOB_FAILED';
    error.jobId = jobId;
    return error;
}

function clearLocalWorkerHealthCache() {
    healthCache.clear();
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

function mapListedModels(rows) {
    return rows.map((row) => ({
        id: row.id,
        name: row.name || row.id,
        scale: row.scale || 4,
        scales: Array.isArray(row.scales) ? row.scales.map(Number).filter((n) => n > 0) : undefined,
        speed: row.speed || undefined,
        enabled: row.enabled !== false
    }));
}

async function listModelsForWorker(cfg, timeoutMs) {
    const { response, body } = await fetchJson(cfg.url + '/models', {
        method: 'GET',
        headers: authHeaders(cfg.key)
    }, timeoutMs || 4000);
    if (!response.ok || !body || !Array.isArray(body.models)) {
        throw new Error('GET /models failed (HTTP ' + response.status + ').');
    }
    return mapListedModels(body.models);
}

async function probeWorker(worker, opts) {
    const now = Date.now();
    const cached = healthCache.get(worker.url);
    if (!opts.force && cached && (now - cached.at) < HEALTH_TTL_MS) return cached.value;
    const timeoutMs = opts.timeoutMs || 4000;
    let value;
    try {
        const { response, body } = await fetchJson(worker.url + '/health', {
            method: 'GET',
            headers: authHeaders(worker.key)
        }, timeoutMs);
        if (!response.ok || !body || body.auth !== 'ok') {
            value = {
                id: worker.id,
                role: workerRole(worker),
                name: workerDisplayName(worker),
                online: false,
                configured: true,
                maxScale: worker.maxScale,
                priority: worker.priority,
                models: worker.models.length ? worker.models : (workerRole(worker) === 'ruiko' ? LOCAL_UPSCALE_MODELS.slice() : []),
                jobTypes: (body && body.job_types) || [],
                animateBackends: (body && body.animate_backends) || [],
                reason: workerDisplayName(worker) + ' health check failed (HTTP ' + response.status + ').'
            };
        } else {
            value = {
                id: worker.id,
                role: workerRole(worker),
                name: workerDisplayName(worker),
                online: true,
                configured: true,
                maxScale: worker.maxScale,
                priority: worker.priority,
                version: body.version || null,
                gpu: body.gpu || null,
                queueLength: body.queue_length,
                loadedModels: body.loaded_models || [],
                models: worker.models.length ? worker.models : LOCAL_UPSCALE_MODELS.slice(),
                jobTypes: body.job_types || ['upscale'],
                animateBackends: body.animate_backends || [],
                animateLoaded: body.animate_loaded || [],
                reason: null
            };
        }
    } catch (err) {
        value = {
            id: worker.id,
            role: workerRole(worker),
            name: workerDisplayName(worker),
            online: false,
            configured: true,
            maxScale: worker.maxScale,
            priority: worker.priority,
            models: worker.models.length ? worker.models : (workerRole(worker) === 'ruiko' ? LOCAL_UPSCALE_MODELS.slice() : []),
            jobTypes: [],
            animateBackends: [],
            reason: err && err.message ? err.message : (workerDisplayName(worker) + ' is unreachable.')
        };
    }
    if (value.online) {
        try {
            const listed = await listModelsForWorker(worker, timeoutMs);
            if (listed && listed.length) value.models = listed;
        } catch (_) {
            if (!value.models.length && value.role === 'ruiko') value.models = LOCAL_UPSCALE_MODELS.slice();
        }
    }
    healthCache.set(worker.url, { at: now, value });
    return value;
}

function unionModels(rows) {
    const seen = new Set();
    const models = [];
    rows.forEach((row) => {
        (row.models || []).forEach((model) => {
            if (!model || !model.id || seen.has(model.id) || model.enabled === false) return;
            seen.add(model.id);
            models.push({ id: model.id, name: model.name || model.id, scale: model.scale || 4 });
        });
    });
    return models;
}

function unionBackends(rows) {
    const seen = new Set();
    const backends = [];
    rows.forEach((row) => {
        (row.animateBackends || []).forEach((backend) => {
            const id = backend && backend.id ? backend.id : backend;
            if (!id || seen.has(id)) return;
            seen.add(id);
            backends.push(backend);
        });
    });
    return backends;
}

function emptyHealth(reason) {
    return {
        online: false,
        configured: false,
        models: LOCAL_UPSCALE_MODELS.slice(),
        jobTypes: [],
        animateBackends: [],
        animateLoaded: [],
        workers: [],
        gpu: null,
        version: null,
        queueLength: null,
        reason: reason || 'localWorker.url and localWorker.key are not set in secure.config.json.'
    };
}

function aggregateHealth(rows) {
    if (!rows.length) return emptyHealth();
    const online = rows.filter((row) => row.online);
    const primary = online[0] || rows[0];
    const jobTypes = [];
    rows.forEach((row) => {
        (row.jobTypes || []).forEach((type) => {
            if (jobTypes.indexOf(type) === -1) jobTypes.push(type);
        });
    });
    const models = unionModels(online.length ? online : rows);
    let queueLength = 0;
    let queueKnown = false;
    online.forEach((row) => {
        if (row.queueLength != null && Number.isFinite(Number(row.queueLength))) {
            queueLength += Number(row.queueLength);
            queueKnown = true;
        }
    });
    return {
        online: online.length > 0,
        configured: true,
        version: primary.version || null,
        gpu: primary.gpu || null,
        queueLength: queueKnown ? queueLength : primary.queueLength,
        loadedModels: primary.loadedModels || [],
        models: models.length ? models : LOCAL_UPSCALE_MODELS.slice(),
        jobTypes: jobTypes.length ? jobTypes : (online.length ? ['upscale'] : []),
        animateBackends: unionBackends(online.length ? online : rows),
        animateLoaded: primary.animateLoaded || [],
        workers: rows.map((row) => ({
            id: row.id,
            role: row.role,
            name: row.name,
            online: !!row.online,
            maxScale: row.maxScale,
            priority: row.priority,
            gpu: row.gpu || null,
            models: (row.models || []).filter((model) => model.enabled !== false).map((model) => ({
                id: model.id,
                name: model.name || model.id,
                scale: model.scale || 4,
                scales: model.scales,
                speed: model.speed
            })),
            jobTypes: row.jobTypes || [],
            animateBackends: row.animateBackends || [],
            reason: row.reason || null
        })),
        reason: online.length ? null : (primary.reason || 'Local upscaler is unreachable.')
    };
}

async function checkLocalWorkerHealth(globalResources, opts = {}) {
    let workers = readLocalWorkers(globalResources);
    if (opts.workerId) {
        const id = String(opts.workerId);
        workers = workers.filter((worker) => worker.id === id || workerRole(worker) === id);
    }
    if (!workers.length) return emptyHealth();
    const rows = await Promise.all(workers.map((worker) => probeWorker(worker, opts)));
    return aggregateHealth(rows);
}

function mergeWorkers(configured, health) {
    const rows = (health && health.workers) || [];
    return configured.map((worker) => {
        const live = rows.find((row) => row.id === worker.id) || null;
        return {
            id: worker.id,
            url: worker.url,
            key: worker.key,
            maxScale: worker.maxScale,
            priority: worker.priority,
            animate: worker.animate,
            online: !!(live && live.online),
            jobTypes: (live && live.jobTypes) || [],
            animateBackends: (live && live.animateBackends) || [],
            models: (live && live.models && live.models.length) ? live.models : worker.models,
            gpu: live && live.gpu
        };
    });
}

async function loadRoutableWorkers(globalResources) {
    const configured = readLocalWorkers(globalResources);
    if (!configured.length) return { health: emptyHealth(), workers: [] };
    const health = await checkLocalWorkerHealth(globalResources);
    return { health, workers: mergeWorkers(configured, health) };
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
    return listModelsForWorker(cfg, opts.timeoutMs || 4000);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upscaleBufferWithLocalWorker(globalResources, imageBuffer, options = {}) {
    const loaded = await loadRoutableWorkers(globalResources);
    if (!loaded.workers.length) {
        throw localWorkerOfflineError('localWorker.url and localWorker.key are not set in secure.config.json.');
    }
    if (!loaded.health.online) {
        throw localWorkerOfflineError(loaded.health.reason);
    }
    const target = selectUpscaleTarget(loaded.workers, options);
    if (!target) {
        throw localWorkerOfflineError('No local worker can upscale at ' + normalizeRequestedScale(options.scale) + 'x.');
    }
    const cfg = { url: target.worker.url, key: target.worker.key };
    const model = target.model;
    const scale = target.scale;
    const workerName = workerDisplayName(target.worker);
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
        const error = new Error(workerName + ' upscaler rejected the image: ' + detail);
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
            options.onProgress(Number.isFinite(progress) ? progress : 0, status.body.status, jobId, { workerName });
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
    return { buffer: bytes, jobId, model, scale, workerId: target.worker.id };
}

function isLocalAnimateBackend(value) {
    return LOCAL_ANIMATE_BACKENDS.some((row) => row.id === value);
}

async function fetchAnimateResult(cfg, jobId, format) {
    const result = await fetch(cfg.url + '/jobs/' + jobId + '/result?format=' + format, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + cfg.key },
        signal: AbortSignal.timeout(60000)
    });
    if (!result.ok) {
        throw localWorkerJobError(jobId, format + ' result HTTP ' + result.status);
    }
    return Buffer.from(await result.arrayBuffer());
}

// Latest latent/frame filmstrip (JPEG) for a running animate job, as base64; null if none yet.
async function fetchAnimatePreview(cfg, jobId) {
    try {
        const res = await fetch(cfg.url + '/jobs/' + jobId + '/preview', {
            method: 'GET',
            headers: authHeaders(cfg.key),
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer()).toString('base64');
    } catch (_err) {
        return null;
    }
}

async function animateBufferWithLocalWorker(globalResources, imageBuffer, options = {}) {
    const loaded = await loadRoutableWorkers(globalResources);
    if (!loaded.workers.length) {
        throw localWorkerOfflineError('localWorker.url and localWorker.key are not set in secure.config.json.');
    }
    if (!loaded.health.online) {
        throw localWorkerOfflineError(loaded.health.reason);
    }
    const motionPrompt = String(options.motionPrompt || '').trim();
    if (!motionPrompt) {
        throw new Error('motionPrompt is required for animate jobs.');
    }
    const target = selectAnimateWorker(loaded.workers);
    if (!target) {
        const error = new Error('No local worker supports animate. Redeploy the Ruiko worker (a still upscaler would otherwise run the job as an upscale).');
        error.code = 'LOCAL_WORKER_NO_ANIMATE';
        throw error;
    }
    const cfg = { url: target.url, key: target.key };
    const frames = Number.isFinite(Number(options.frames)) ? Math.round(Number(options.frames)) : DEFAULT_ANIMATE_FRAMES;
    const fps = Number.isFinite(Number(options.fps)) ? Math.round(Number(options.fps)) : DEFAULT_ANIMATE_FPS;
    const loop = options.loop === undefined ? true : !!options.loop;
    const backend = isLocalAnimateBackend(options.backend) ? options.backend : DEFAULT_ANIMATE_BACKEND;
    const backends = target.animateBackends || [];
    if (!backends.some((item) => (item && (item.id || item)) === backend)) {
        const error = new Error('Local worker does not support animate backend "' + backend + '"; redeploy the worker (it would otherwise run the job as an upscale).');
        error.code = 'LOCAL_WORKER_NO_ANIMATE';
        throw error;
    }

    let posted;
    try {
        posted = await fetchJson(cfg.url + '/jobs', {
            method: 'POST',
            headers: {
                ...authHeaders(cfg.key),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'animate',
                image: Buffer.from(imageBuffer).toString('base64'),
                motion_prompt: motionPrompt,
                frames,
                fps,
                loop,
                backend
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
        const error = new Error('Local animate rejected the request: ' + detail);
        error.code = 'LOCAL_WORKER_REJECTED';
        throw error;
    }
    const jobId = posted.body.job_id;
    if (typeof options.onJobId === 'function') options.onJobId(jobId);
    const deadline = Date.now() + (options.timeoutMs || 30 * 60 * 1000);
    let last = null;
    let lastPreviewSeq = 0;
    const workerName = workerDisplayName(target);
    while (Date.now() < deadline) {
        await sleep(options.pollMs || 600);
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
        let previewBase64 = null;
        const seq = Number(status.body.preview_seq) || 0;
        if (seq > lastPreviewSeq) {
            previewBase64 = await fetchAnimatePreview(cfg, jobId);
            if (previewBase64) lastPreviewSeq = seq;
        }
        if (typeof options.onProgress === 'function') {
            const progress = Number(status.body.progress);
            options.onProgress(Number.isFinite(progress) ? progress : 0, status.body.status, jobId, {
                stage: status.body.stage || null,
                step: status.body.step != null ? Number(status.body.step) : null,
                totalSteps: status.body.total_steps != null ? Number(status.body.total_steps) : null,
                previewSeq: lastPreviewSeq,
                previewBase64,
                workerName
            });
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
    const buffers = {};
    for (const format of ANIMATE_RESULT_FORMATS) {
        try {
            buffers[format] = await fetchAnimateResult(cfg, jobId, format);
        } catch (err) {
            if (!ANIMATE_OPTIONAL_FORMATS.has(format)) throw err;
        }
    }
    return { buffers, jobId, motionPrompt, frames, fps, loop, backend, workerId: target.id };
}

module.exports = {
    LOCAL_UPSCALE_MODELS,
    DEFAULT_LOCAL_MODEL,
    G10_FAST_MODEL,
    G10_SLOW_MODEL,
    LOCAL_ANIMATE_BACKENDS,
    DEFAULT_ANIMATE_BACKEND,
    DEFAULT_ANIMATE_FRAMES,
    DEFAULT_ANIMATE_FPS,
    ANIMATE_RESULT_FORMATS,
    HEALTH_TTL_MS,
    normalizeUpscalerName,
    isLocalUpscaler,
    isLocalAnimateBackend,
    readLocalWorkers,
    readLocalWorkerConfig,
    workerRole,
    workerDisplayName,
    selectUpscaleTarget,
    selectAnimateWorker,
    explicitUpscaleModel,
    normalizeRequestedScale,
    localWorkerOfflineError,
    clearLocalWorkerHealthCache,
    checkLocalWorkerHealth,
    assertLocalWorkerOnline,
    listLocalWorkerModels,
    upscaleBufferWithLocalWorker,
    animateBufferWithLocalWorker
};
