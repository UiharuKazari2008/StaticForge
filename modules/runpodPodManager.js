/**
 * Managed RunPod GPU Pods (REST start/stop + idle auto-shutdown).
 * Distinct from serverless ESRGAN (`modules/imageUpscaling.js`).
 */

const https = require('https');

const RUNPOD_REST_HOST = 'rest.runpod.io';
const POLL_MS = 30000;
const REQUEST_TIMEOUT_MS = 20000;
const DIRECT_AGENT = new https.Agent({ keepAlive: false });
const DEFAULT_IDLE_MINUTES = 15;

function toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
}

function normalizeRemoteStatus(remote) {
    const raw = remote?.desiredStatus || remote?.status || remote?.pod?.desiredStatus || '';
    const u = String(raw).toUpperCase();
    if (u === 'RUNNING') return 'running';
    if (u === 'EXITED' || u === 'STOPPED') return 'stopped';
    if (u === 'TERMINATED') return 'terminated';
    if (!u) return 'unknown';
    return u.toLowerCase();
}

function unwrapPod(remote) {
    if (remote && remote.pod && typeof remote.pod === 'object') return remote.pod;
    return remote || {};
}

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function extractPodCost(remote) {
    const pod = unwrapPod(remote);
    const adjusted = toFiniteNumber(pod.adjustedCostPerHr);
    const base = toFiniteNumber(pod.costPerHr);
    const costPerHr = adjusted != null ? adjusted : base;
    const lastStartedAt = typeof pod.lastStartedAt === 'string' && pod.lastStartedAt ? pod.lastStartedAt : null;
    let sessionCost = null;
    const desired = String(pod.desiredStatus || pod.status || '').toUpperCase();
    if (costPerHr != null && lastStartedAt && desired === 'RUNNING') {
        const started = Date.parse(lastStartedAt);
        if (Number.isFinite(started)) {
            sessionCost = costPerHr * Math.max(0, (Date.now() - started) / 3600000);
        }
    }
    const gpuName = pod.gpu && (pod.gpu.displayName || pod.gpu.id);
    return {
        costPerHr,
        sessionCost,
        lastStartedAt,
        gpuName: gpuName ? String(gpuName) : null
    };
}

class RunpodPodManager {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this._busy = new Map();
        this._lastUsageAt = new Map();
        this._noUsersSince = null;
        this._snapshot = { pods: [], loggedInUsers: 0, fetchedAt: 0, configured: false };
        this._pollTimerId = null;
        this._tickBusy = false;
        this._started = false;
    }

    log(level, message) {
        const logger = this.globalResources.getLogger();
        logger.runpod(level, message);
    }

    start() {
        if (this._started) return;
        this._started = true;
        const configs = this.getManagedConfigs();
        this.log('info', `Watcher started (${configs.length} managed pod${configs.length === 1 ? '' : 's'})`);
        this._pollTimerId = this.globalResources.registerTimer(
            'runpodPodIdleWatch',
            'interval',
            () => {
                this.tick().catch((err) => {
                    this.log('error', `Idle watch tick failed: ${err.message}`);
                });
            },
            POLL_MS
        );
        this.tick().catch((err) => {
            this.log('error', `Initial pod poll failed: ${err.message}`);
        });
    }

    getManagedConfigs() {
        const runpod = this.globalResources.getSecureConfig({ path: 'runpod' }) || {};
        const defaultIdle = toPositiveInt(runpod.idleMinutes, DEFAULT_IDLE_MINUTES);
        const list = Array.isArray(runpod.managedPods) ? runpod.managedPods : [];
        const seen = new Set();
        const configs = [];
        for (const entry of list) {
            if (!entry || typeof entry !== 'object') continue;
            const id = String(entry.id || '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            configs.push({
                id,
                name: String(entry.name || id).trim() || id,
                autoShutdown: entry.autoShutdown !== false,
                idleMinutes: toPositiveInt(entry.idleMinutes, defaultIdle)
            });
        }
        return configs;
    }

    countLoggedInUsers() {
        try {
            const wsServer = this.globalResources.getWebSocketServer();
            const users = wsServer.getConnectedUsers();
            let n = 0;
            for (const info of users) {
                if (info && info.authenticated) n += 1;
            }
            return n;
        } catch (_err) {
            return 0;
        }
    }

    noteUsage(podId) {
        const key = podId ? String(podId) : '*';
        this._lastUsageAt.set(key, Date.now());
    }

    getCachedSnapshot() {
        return this._snapshot;
    }

    async getSnapshot({ refresh = true } = {}) {
        const configs = this.getManagedConfigs();
        const loggedInUsers = this.countLoggedInUsers();
        if (loggedInUsers > 0) {
            this._noUsersSince = null;
        } else if (this._noUsersSince == null) {
            this._noUsersSince = Date.now();
        }

        const prevById = new Map((this._snapshot.pods || []).map((p) => [p.id, p]));
        const pods = await Promise.all(configs.map(async (cfg) => {
            const prev = prevById.get(cfg.id) || {};
            const busy = this._busy.get(cfg.id) || null;
            let status = prev.status || 'unknown';
            let error = null;
            let cost = {
                costPerHr: prev.costPerHr != null ? prev.costPerHr : null,
                sessionCost: prev.sessionCost != null ? prev.sessionCost : null,
                lastStartedAt: prev.lastStartedAt || null,
                gpuName: prev.gpuName || null
            };
            if (busy) {
                status = busy;
            } else if (refresh) {
                try {
                    const remote = await this._getRemotePod(cfg.id);
                    status = normalizeRemoteStatus(remote);
                    cost = extractPodCost(remote);
                    if (status !== 'running') cost.sessionCost = null;
                } catch (err) {
                    error = err.message;
                    this.log('error', `Status ${cfg.id}: ${err.message}`);
                }
            }
            return {
                id: cfg.id,
                name: cfg.name,
                status,
                autoShutdown: cfg.autoShutdown,
                idleMinutes: cfg.idleMinutes,
                lastUsageAt: this._lastUsageAt.get(cfg.id) || null,
                costPerHr: cost.costPerHr,
                sessionCost: cost.sessionCost,
                lastStartedAt: cost.lastStartedAt,
                gpuName: cost.gpuName,
                error
            };
        }));

        this._snapshot = {
            pods,
            loggedInUsers,
            fetchedAt: Date.now(),
            configured: configs.length > 0,
            hasApiKey: !!this._getApiKey()
        };
        return this._snapshot;
    }

    async startPod(podId) {
        const cfg = this._requireManaged(podId);
        if (this._busy.has(cfg.id)) {
            throw new Error(`${cfg.name} is already ${this._busy.get(cfg.id)}`);
        }
        this._busy.set(cfg.id, 'starting');
        this._patchLocalStatus(cfg.id, 'starting');
        this.broadcast();
        try {
            await this._rest('POST', `/pods/${encodeURIComponent(cfg.id)}/start`);
            this.noteUsage(cfg.id);
            this.log('info', `Started ${cfg.name} (${cfg.id})`);
        } catch (err) {
            this.log('error', `Start ${cfg.name} failed: ${err.message}`);
            throw err;
        } finally {
            this._busy.delete(cfg.id);
            await this.getSnapshot({ refresh: true });
            this.broadcast();
        }
        return this._snapshot;
    }

    async stopPod(podId, reason = 'manual') {
        const cfg = this._requireManaged(podId);
        if (this._busy.has(cfg.id)) {
            throw new Error(`${cfg.name} is already ${this._busy.get(cfg.id)}`);
        }
        this._busy.set(cfg.id, 'stopping');
        this._patchLocalStatus(cfg.id, 'stopping');
        this.broadcast();
        try {
            await this._rest('POST', `/pods/${encodeURIComponent(cfg.id)}/stop`);
            this.noteUsage(cfg.id);
            this.log('info', `Stopped ${cfg.name} (${cfg.id}) — ${reason}`);
        } catch (err) {
            this.log('error', `Stop ${cfg.name} failed: ${err.message}`);
            throw err;
        } finally {
            this._busy.delete(cfg.id);
            await this.getSnapshot({ refresh: true });
            this.broadcast();
        }
        return this._snapshot;
    }

    async tick() {
        if (this._tickBusy) return;
        this._tickBusy = true;
        try {
            const before = JSON.stringify(this._snapshot);
            const snap = await this.getSnapshot({ refresh: true });
            await this._maybeAutoStop(snap);
            const after = JSON.stringify(this._snapshot);
            if (after !== before) {
                this.broadcast();
            }
        } finally {
            this._tickBusy = false;
        }
    }

    broadcast() {
        try {
            const wsServer = this.globalResources.getWebSocketServer();
            wsServer.broadcast({
                type: 'runpod_pods_status_update',
                data: this._snapshot,
                timestamp: new Date().toISOString()
            }, (clientInfo) => !!(clientInfo && clientInfo.authenticated));
        } catch (_err) {
            // WebSocket server not ready yet
        }
    }

    _getApiKey() {
        try {
            return this.globalResources.getApiKeyManager().getActiveApiKey('runpod') || null;
        } catch (_err) {
            return null;
        }
    }

    _requireManaged(podId) {
        const id = String(podId || '').trim();
        const cfg = this.getManagedConfigs().find((p) => p.id === id);
        if (!cfg) {
            throw new Error('Unknown managed RunPod id');
        }
        return cfg;
    }

    _patchLocalStatus(podId, status) {
        const pods = (this._snapshot.pods || []).map((p) => (
            p.id === podId ? { ...p, status, error: null } : p
        ));
        this._snapshot = { ...this._snapshot, pods, fetchedAt: Date.now() };
    }

    async _maybeAutoStop(snap) {
        if (snap.loggedInUsers > 0) return;
        const now = Date.now();
        const noUsersSince = this._noUsersSince || now;
        for (const pod of snap.pods) {
            if (!pod.autoShutdown) continue;
            if (this._busy.has(pod.id)) continue;
            if (pod.status !== 'running') continue;
            const idleMs = pod.idleMinutes * 60 * 1000;
            const lastUsage = this._lastUsageAt.get(pod.id) || 0;
            const usersIdle = (now - noUsersSince) >= idleMs;
            const usageIdle = !lastUsage || (now - lastUsage) >= idleMs;
            if (!usersIdle || !usageIdle) continue;
            try {
                await this.stopPod(pod.id, `auto-shutdown (idle ${pod.idleMinutes}m, no Dreamscape sessions)`);
            } catch (_err) {
                // stopPod already logs
            }
        }
    }

    async _getRemotePod(podId) {
        return this._rest('GET', `/pods/${encodeURIComponent(podId)}?includeSavingsPlans=true&includeMachine=true`);
    }

    _rest(method, pathname) {
        const apiKey = this._getApiKey();
        if (!apiKey) {
            return Promise.reject(new Error('RunPod API key is not configured'));
        }
        return new Promise((resolve, reject) => {
            const options = {
                hostname: RUNPOD_REST_HOST,
                port: 443,
                path: `/v1${pathname}`,
                method,
                agent: DIRECT_AGENT,
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${apiKey}`
                }
            };
            const req = https.request(options, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    if (text) {
                        try {
                            json = JSON.parse(text);
                        } catch (_err) {
                            json = { raw: text };
                        }
                    }
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json || {});
                        return;
                    }
                    const msg = (json && (json.message || json.error || json.raw)) || `HTTP ${res.statusCode}`;
                    const err = new Error(String(msg));
                    err.statusCode = res.statusCode;
                    reject(err);
                });
            });
            req.on('error', reject);
            req.setTimeout(REQUEST_TIMEOUT_MS, () => {
                req.destroy();
                reject(new Error('RunPod API timeout'));
            });
            req.end();
        });
    }
}

module.exports = { RunpodPodManager };
