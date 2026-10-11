'use strict';

/**
 * Status rows for services Dreamscape already probes.
 * Ruiko: checkLocalWorkerHealth (/health + /models).
 * Grimoire browser sidecar: GET {origin}/health.
 * Replication master: GET {masterAccessUrl}/replication/status (same probe as probeMasterReachable).
 * NovelAI: NovelAiStatusMonitor.refresh (status.io).
 * Sequenzia is a local upload folder. Yozora has no health endpoint. Neither is listed.
 * Responses are an allowlisted row. Keys, tokens, and passwords are never copied out.
 */

const fs = require('fs');
const { spawn } = require('child_process');
const { checkLocalWorkerHealth, readLocalWorkerConfig } = require('./localUpscaleWorker');
const { grimoireBrowserConfig } = require('./grimoireBrowserBridge');
const { canGalleryUseRemoteMaster } = require('./replication/replicationContracts');
const { httpRequestBuffer } = require('./replicationRemoteFetch');

const REMOTE_WORKER_IDS = Object.freeze(['ruiko', 'grimoire-browser', 'replication-master', 'novelai', 'claude-xi']);
const DEFAULT_TIMEOUT_MS = 4000;
const SLOW_LATENCY_MS = 1500;
const STATUSES = new Set(['healthy', 'degraded', 'offline', 'unconfigured']);

function clampTimeout(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
    return Math.max(200, Math.min(8000, Math.round(n)));
}

function publicHostFromUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try {
        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : ('http://' + text);
        const url = new URL(withScheme);
        return url.host || '';
    } catch (_) {
        return '';
    }
}

function scrubText(value, secrets) {
    let out = String(value == null ? '' : value);
    out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]*@/gi, '$1');
    out = out.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
    out = out.replace(/([?&#](?:token|key|password|secret|authorization)=)[^&\s#]+/gi, '$1[redacted]');
    const list = Array.isArray(secrets) ? secrets : [];
    for (const secret of list) {
        const needle = String(secret || '');
        if (needle.length < 6) continue;
        if (out.includes(needle)) out = out.split(needle).join('[redacted]');
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function joinOrigin(raw, pathname) {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const base = url.toString().replace(/\/+$/, '');
    return base + (pathname.startsWith('/') ? pathname : ('/' + pathname));
}

function withTimeout(promise, ms) {
    let timer;
    let settled = false;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            settled = true;
            const error = new Error('timed out');
            error.code = 'TIMEOUT';
            reject(error);
        }, ms);
    });
    const guarded = Promise.resolve(promise).then(
        (value) => (settled ? undefined : value),
        (err) => {
            if (settled) return undefined;
            throw err;
        }
    );
    return Promise.race([guarded, timeout]).finally(() => {
        settled = true;
        clearTimeout(timer);
    });
}

function row(fields, secrets) {
    const status = STATUSES.has(fields.status) ? fields.status : 'offline';
    const latency = Number(fields.latencyMs);
    const latencyMs = status === 'unconfigured' || !Number.isFinite(latency) || latency < 0
        ? null
        : Math.round(latency);
    return {
        id: String(fields.id || ''),
        name: String(fields.name || ''),
        host: scrubText(publicHostFromUrl(fields.host), secrets),
        status,
        checkedAt: fields.checkedAt || new Date().toISOString(),
        latencyMs,
        detail: scrubText(fields.detail || '', secrets)
    };
}

function pushSecret(list, value) {
    const text = String(value || '');
    if (text.length >= 6) list.push(text);
}

function readReplicationConfig(globalResources) {
    try {
        const service = globalResources && typeof globalResources.getReplicationService === 'function'
            ? globalResources.getReplicationService()
            : null;
        if (!service || typeof service.getReplicationConfig !== 'function') return null;
        return service.getReplicationConfig() || null;
    } catch (_) {
        return null;
    }
}

function safeDetail(err) {
    if (!err) return 'unreachable';
    if (err.code === 'TIMEOUT' || err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
    const message = err.message ? String(err.message) : 'unreachable';
    if (/timeout|timed out|aborted/i.test(message)) return 'timed out';
    if (/^HTTP \d+$/.test(message)) return message;
    return 'unreachable';
}

async function checkRuiko(globalResources, opts, secrets) {
    const name = 'Ruiko Upscaler';
    const cfg = readLocalWorkerConfig(globalResources);
    const host = publicHostFromUrl(cfg.url);
    const checkedAt = new Date().toISOString();
    if (!cfg.url || !cfg.key) {
        return row({
            id: 'ruiko',
            name,
            host: '',
            status: 'unconfigured',
            checkedAt,
            detail: 'localWorker.url and localWorker.key are not set'
        }, secrets);
    }
    const started = Date.now();
    const slice = Math.max(200, Math.floor(opts.timeoutMs / 2));
    let health;
    try {
        health = await withTimeout(
            checkLocalWorkerHealth(globalResources, { force: true, timeoutMs: slice }),
            opts.timeoutMs
        );
    } catch (err) {
        return row({
            id: 'ruiko',
            name,
            host,
            status: 'offline',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            detail: safeDetail(err)
        }, secrets);
    }
    const latencyMs = Date.now() - started;
    if (!health || health.configured === false) {
        return row({
            id: 'ruiko',
            name,
            host: '',
            status: 'unconfigured',
            checkedAt: new Date().toISOString(),
            detail: health && health.reason
        }, secrets);
    }
    if (!health.online) {
        return row({
            id: 'ruiko',
            name,
            host,
            status: 'offline',
            checkedAt: new Date().toISOString(),
            latencyMs,
            detail: health.reason || 'Ruiko is unreachable'
        }, secrets);
    }
    const backlog = Number(health.queueLength) >= 4;
    if (backlog || latencyMs >= opts.slowMs) {
        return row({
            id: 'ruiko',
            name,
            host,
            status: 'degraded',
            checkedAt: new Date().toISOString(),
            latencyMs,
            detail: backlog ? 'Queue is backed up' : 'Slow response'
        }, secrets);
    }
    return row({
        id: 'ruiko',
        name,
        host,
        status: 'healthy',
        checkedAt: new Date().toISOString(),
        latencyMs,
        detail: ''
    }, secrets);
}

async function checkGrimoire(config, opts, secrets) {
    const name = 'Grimoire Browser';
    const origin = config && config.origin ? String(config.origin) : '';
    const host = publicHostFromUrl(origin);
    const checkedAt = new Date().toISOString();
    if (!origin) {
        return row({
            id: 'grimoire-browser',
            name,
            host: '',
            status: 'unconfigured',
            checkedAt,
            detail: 'Grimoire browser origin is not configured'
        }, secrets);
    }
    const started = Date.now();
    try {
        const response = await fetch(joinOrigin(origin, '/health'), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(opts.timeoutMs)
        });
        const latencyMs = Date.now() - started;
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || body.ok !== true) {
            return row({
                id: 'grimoire-browser',
                name,
                host,
                status: 'offline',
                checkedAt: new Date().toISOString(),
                latencyMs,
                detail: 'Health check failed (HTTP ' + response.status + ')'
            }, secrets);
        }
        if (body.browser === false) {
            return row({
                id: 'grimoire-browser',
                name,
                host,
                status: 'degraded',
                checkedAt: new Date().toISOString(),
                latencyMs,
                detail: 'Sidecar is up; Chromium is not connected'
            }, secrets);
        }
        if (!config.token) {
            return row({
                id: 'grimoire-browser',
                name,
                host,
                status: 'degraded',
                checkedAt: new Date().toISOString(),
                latencyMs,
                detail: 'Sidecar is up; bearer token is not configured'
            }, secrets);
        }
        if (latencyMs >= opts.slowMs) {
            return row({
                id: 'grimoire-browser',
                name,
                host,
                status: 'degraded',
                checkedAt: new Date().toISOString(),
                latencyMs,
                detail: 'Slow response'
            }, secrets);
        }
        return row({
            id: 'grimoire-browser',
            name,
            host,
            status: 'healthy',
            checkedAt: new Date().toISOString(),
            latencyMs,
            detail: ''
        }, secrets);
    } catch (err) {
        return row({
            id: 'grimoire-browser',
            name,
            host,
            status: 'offline',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            detail: safeDetail(err)
        }, secrets);
    }
}

async function checkReplication(config, opts, secrets) {
    const name = 'Replication Master';
    const checkedAt = new Date().toISOString();
    const accessUrl = config && config.masterAccessUrl ? String(config.masterAccessUrl) : '';
    const host = publicHostFromUrl(accessUrl);
    const role = config && config.role ? config.role : 'standalone';
    const remoteClient = role === 'child' || role === 'ephemeral';
    if (!accessUrl || !remoteClient) {
        return row({
            id: 'replication-master',
            name,
            host: '',
            status: 'unconfigured',
            checkedAt,
            detail: 'No remote master is configured'
        }, secrets);
    }
    if (!canGalleryUseRemoteMaster(config)) {
        return row({
            id: 'replication-master',
            name,
            host,
            status: 'degraded',
            checkedAt,
            detail: 'Airgapped; the remote master is not contacted'
        }, secrets);
    }
    const started = Date.now();
    try {
        const headers = { 'User-Agent': 'StaticForge-Replication/1.0', Accept: 'application/json' };
        if (config.replicationToken) headers['X-Replication-Token'] = config.replicationToken;
        await withTimeout(httpRequestBuffer(joinOrigin(accessUrl, '/replication/status'), {
            headers,
            timeoutMs: opts.timeoutMs
        }), opts.timeoutMs + 250);
        const latencyMs = Date.now() - started;
        if (latencyMs >= opts.slowMs) {
            return row({
                id: 'replication-master',
                name,
                host,
                status: 'degraded',
                checkedAt: new Date().toISOString(),
                latencyMs,
                detail: 'Slow response'
            }, secrets);
        }
        return row({
            id: 'replication-master',
            name,
            host,
            status: 'healthy',
            checkedAt: new Date().toISOString(),
            latencyMs,
            detail: ''
        }, secrets);
    } catch (err) {
        return row({
            id: 'replication-master',
            name,
            host,
            status: 'offline',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            detail: safeDetail(err)
        }, secrets);
    }
}

function novelAiTone(payload) {
    if (!payload) return { status: 'offline', detail: 'Status not loaded' };
    if (payload.ok === false && payload.fetchError && !payload.overall) {
        return { status: 'offline', detail: payload.fetchError };
    }
    if (payload.imageGenerationBlocked) {
        return { status: 'offline', detail: 'Image generation is unavailable' };
    }
    const incident = payload.activeIncident;
    if (incident && incident.severity === 'outage') {
        return { status: 'offline', detail: incident.status || 'Outage' };
    }
    const code = payload.overall && payload.overall.statusCode;
    if (code != null && code >= 400) {
        return { status: 'offline', detail: payload.overall.status || 'Outage' };
    }
    if (incident || payload.stale || (code != null && code !== 100)) {
        const detail = (incident && (incident.status || incident.component))
            || (payload.overall && payload.overall.status)
            || (payload.stale ? 'Stale status' : 'Degraded');
        return { status: 'degraded', detail };
    }
    return { status: 'healthy', detail: '' };
}

async function checkNovelAi(globalResources, opts, secrets) {
    const name = 'NovelAI';
    const host = 'status.novelai.net';
    const checkedAt = new Date().toISOString();
    const monitor = globalResources && typeof globalResources.getNovelAiStatusMonitor === 'function'
        ? globalResources.getNovelAiStatusMonitor()
        : null;
    if (!monitor || typeof monitor.refresh !== 'function' || typeof monitor.getClientPayload !== 'function') {
        return row({
            id: 'novelai',
            name,
            host: '',
            status: 'unconfigured',
            checkedAt,
            detail: 'NovelAI status monitor is not running'
        }, secrets);
    }
    const started = Date.now();
    try {
        await withTimeout(Promise.resolve(monitor.refresh(true)), opts.timeoutMs);
    } catch (err) {
        return row({
            id: 'novelai',
            name,
            host,
            status: 'offline',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            detail: safeDetail(err)
        }, secrets);
    }
    const latencyMs = Date.now() - started;
    const tone = novelAiTone(monitor.getClientPayload());
    if (tone.status === 'healthy' && latencyMs >= opts.slowMs) {
        tone.status = 'degraded';
        tone.detail = 'Slow response';
    }
    return row({
        id: 'novelai',
        name,
        host,
        status: tone.status,
        checkedAt: new Date().toISOString(),
        latencyMs,
        detail: tone.detail
    }, secrets);
}

// Claude is a local subprocess (bwrap + claude.exe), not a network service, so
// "healthy" means the binary and OAuth token file are both in place and the
// binary actually runs, not a reachability probe like the other rows.
function runClaudeVersionProbe(bin, timeoutMs) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            reject(err);
            return;
        }
        let out = '';
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
            reject(Object.assign(new Error('timed out'), { code: 'TIMEOUT' }));
        }, timeoutMs);
        child.stdout.on('data', (buf) => { out += buf.toString(); });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(out);
            else reject(new Error(`exit ${code}`));
        });
    });
}

async function checkClaudeXi(opts, secrets) {
    const name = 'Claude Runner (Xi)';
    const checkedAt = new Date().toISOString();
    // claudeBin / claudeTokenFile are only ever passed explicitly by tests, to
    // pin this check's result instead of depending on what is actually
    // installed on the host running the test.
    const bin = opts.claudeBin !== undefined ? opts.claudeBin : require('./cursorDirector').findClaude();
    if (!bin) {
        return row({
            id: 'claude-xi',
            name,
            host: '',
            status: 'unconfigured',
            checkedAt,
            detail: 'Claude Code CLI is not installed'
        }, secrets);
    }
    const tokenFile = opts.claudeTokenFile !== undefined ? opts.claudeTokenFile : require('./xiLaunch').resolveClaudeTokenFile({});
    if (!tokenFile || !fs.existsSync(tokenFile)) {
        return row({
            id: 'claude-xi',
            name,
            host: 'local',
            status: 'unconfigured',
            checkedAt,
            detail: 'Claude OAuth token file is missing'
        }, secrets);
    }
    const started = Date.now();
    try {
        const out = await withTimeout(runClaudeVersionProbe(bin, opts.timeoutMs), opts.timeoutMs + 250);
        const latencyMs = Date.now() - started;
        return row({
            id: 'claude-xi',
            name,
            host: 'local',
            status: latencyMs >= opts.slowMs ? 'degraded' : 'healthy',
            checkedAt: new Date().toISOString(),
            latencyMs,
            detail: String(out || '').trim().slice(0, 80)
        }, secrets);
    } catch (err) {
        return row({
            id: 'claude-xi',
            name,
            host: 'local',
            status: 'offline',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            detail: safeDetail(err)
        }, secrets);
    }
}

function gatherSecrets(globalResources, grimoire, replication) {
    const secrets = [];
    try {
        pushSecret(secrets, readLocalWorkerConfig(globalResources).key);
    } catch (_) { /* config read failed */ }
    pushSecret(secrets, grimoire && grimoire.token);
    pushSecret(secrets, replication && replication.replicationToken);
    pushSecret(secrets, replication && replication.replicationReadToken);
    return secrets;
}

async function collectRemoteWorkerStatuses(globalResources, options = {}) {
    const timeoutMs = clampTimeout(options.timeoutMs);
    const slowMs = Number.isFinite(Number(options.slowMs)) && Number(options.slowMs) > 0
        ? Number(options.slowMs)
        : SLOW_LATENCY_MS;
    const opts = { timeoutMs, slowMs, claudeBin: options.claudeBin, claudeTokenFile: options.claudeTokenFile };
    const grimoire = options.grimoireConfig || grimoireBrowserConfig();
    const replication = readReplicationConfig(globalResources);
    const workerId = options.workerId ? String(options.workerId) : '';
    const secrets = gatherSecrets(globalResources, grimoire, replication);
    const checks = [
        ['ruiko', () => checkRuiko(globalResources, opts, secrets)],
        ['grimoire-browser', () => checkGrimoire(grimoire, opts, secrets)],
        ['replication-master', () => checkReplication(replication, opts, secrets)],
        ['novelai', () => checkNovelAi(globalResources, opts, secrets)],
        ['claude-xi', () => checkClaudeXi(opts, secrets)]
    ];
    const selected = workerId ? checks.filter(([id]) => id === workerId) : checks;
    if (workerId && !selected.length) {
        return {
            workers: [],
            checkedAt: new Date().toISOString(),
            error: 'Unknown remote worker'
        };
    }
    const workers = await Promise.all(selected.map(([id, run]) => run().catch(() => row({
        id,
        name: id,
        host: '',
        status: 'offline',
        detail: 'Status check failed'
    }, secrets))));
    return {
        workers,
        checkedAt: new Date().toISOString(),
        error: null
    };
}

module.exports = {
    REMOTE_WORKER_IDS,
    DEFAULT_TIMEOUT_MS,
    SLOW_LATENCY_MS,
    publicHostFromUrl,
    scrubText,
    collectRemoteWorkerStatuses
};
