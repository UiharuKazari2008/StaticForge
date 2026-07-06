/**
 * NovelAI public status page monitor (status.io API, cached server-side).
 * https://status.novelai.net/ — page id 654839612cedb404d4d5f578
 */

const https = require('https');

const STATUS_PAGE_ID = '654839612cedb404d4d5f578';
const STATUS_API_URL = `https://api.status.io/1.0/status/${STATUS_PAGE_ID}`;
const CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

/** @type {readonly string[]} */
const MONITORED_COMPONENTS = ['Image Generation', 'Login', 'Website', 'Payments'];

/** Lower index = higher priority when choosing the active upstream alert. */
const COMPONENT_PRIORITY = {
    'Image Generation': 0,
    Login: 1,
    Website: 2,
    Payments: 3,
};

/** status.io service severity codes — https://kb.status.io/developers/status-codes/ */
const STATUS_CODE = {
    OPERATIONAL: 100,
    MAINTENANCE: 200,
    DEGRADED: 300,
    PARTIAL: 400,
    OUTAGE: 500,
    SECURITY: 600,
};

class NovelAiStatusMonitor {
    constructor(globalResources) {
        this.globalResources = globalResources;
        this.cache = null;
        this.lastFetchMs = 0;
        this.fetchPromise = null;
        this.lastError = null;
    }

    /**
     * @param {boolean} [force]
     * @returns {Promise<object>}
     */
    async refresh(force = false) {
        const now = Date.now();
        if (!force && this.cache && (now - this.lastFetchMs) < CACHE_TTL_MS) {
            return this.cache;
        }
        if (this.fetchPromise) {
            return this.fetchPromise;
        }

        this.fetchPromise = this._fetchStatusPayload()
            .then((payload) => {
                this.cache = payload;
                this.lastFetchMs = Date.now();
                this.lastError = null;
                return payload;
            })
            .catch((error) => {
                this.lastError = error.message || String(error);
                if (this.cache) {
                    return { ...this.cache, stale: true, fetchError: this.lastError };
                }
                return this._buildFallbackPayload(this.lastError);
            })
            .finally(() => {
                this.fetchPromise = null;
            });

        return this.fetchPromise;
    }

    /**
     * Payload for get_app_options and client tray UI.
     * @returns {object}
     */
    getClientPayload() {
        const bootCycleId = this.globalResources?.bootCycleId || null;
        if (!this.cache) {
            return {
                ok: false,
                bootCycleId,
                fetchedAt: null,
                stale: true,
                fetchError: this.lastError || 'Status not loaded yet',
                overall: null,
                components: [],
                activeIncident: null,
                imageGenerationBlocked: false,
            };
        }

        const activeIncident = this._selectActiveIncident(this.cache);
        const imageGenerationBlocked = this._isImageGenerationBlocked(this.cache);

        return {
            ok: !this.cache.fetchError,
            bootCycleId,
            fetchedAt: this.cache.fetchedAt,
            stale: !!this.cache.stale,
            fetchError: this.cache.fetchError || null,
            overall: this.cache.overall,
            components: this.cache.components,
            activeIncident,
            imageGenerationBlocked,
        };
    }

    /**
     * @throws {Error} when Image Generation is in partial outage or worse
     */
    assertImageGenerationAllowed() {
        if (!this.cache) {
            return;
        }
        if (!this._isImageGenerationBlocked(this.cache)) {
            return;
        }
        const component = this._getComponent(this.cache, 'Image Generation');
        const label = component?.status || 'Unavailable';
        throw new Error(`NovelAI Image Generation is currently unavailable (${label}). Check https://status.novelai.net/ for updates.`);
    }

    initializePolling() {
        this.refresh(false).catch((error) => {
            console.warn('⚠️ Initial NovelAI status fetch failed:', error.message);
        });

        if (this._pollTimer) {
            clearInterval(this._pollTimer);
        }

        this._pollTimer = setInterval(() => {
            this.refresh(true).catch((error) => {
                console.warn('⚠️ NovelAI status refresh failed:', error.message);
            });
        }, CACHE_TTL_MS);

        console.log('✓ NovelAI status monitor initialized (3 min refresh)');
    }

    _fetchStatusPayload() {
        return new Promise((resolve, reject) => {
            const req = https.get(STATUS_API_URL, { timeout: FETCH_TIMEOUT_MS }, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(body);
                        resolve(this._normalizeApiResponse(parsed));
                    } catch (error) {
                        reject(new Error(`Invalid JSON: ${error.message}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error('Request timed out'));
            });
            req.on('error', reject);
        });
    }

    _normalizeApiResponse(apiResponse) {
        const result = apiResponse?.result || {};
        const overall = result.status_overall || null;
        const rawComponents = Array.isArray(result.status) ? result.status : [];
        const components = MONITORED_COMPONENTS.map((name) => {
            const match = rawComponents.find((entry) => entry?.name === name);
            if (!match) {
                return {
                    id: null,
                    name,
                    status: 'Unknown',
                    statusCode: null,
                    updated: null,
                    impaired: false,
                    outage: false,
                };
            }
            const statusCode = match.status_code ?? null;
            return {
                id: match.id || null,
                name,
                status: match.status || 'Unknown',
                statusCode,
                updated: match.updated || null,
                impaired: statusCode != null && statusCode >= STATUS_CODE.DEGRADED,
                outage: statusCode != null && statusCode >= STATUS_CODE.PARTIAL,
            };
        });

        const incidents = this._normalizeIncidents(result.incidents);
        const maintenance = this._normalizeMaintenance(result.maintenance);

        return {
            fetchedAt: new Date().toISOString(),
            overall: overall ? {
                status: overall.status,
                statusCode: overall.status_code,
                updated: overall.updated,
            } : null,
            components,
            incidents,
            maintenance,
        };
    }

    _normalizeIncidents(incidentsField) {
        const list = Array.isArray(incidentsField) ? incidentsField : [];
        return list
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                id: entry.id || entry._id || null,
                name: entry.name || entry.title || 'Incident',
                status: entry.status || null,
                statusCode: entry.status_code ?? entry.statusCode ?? null,
                state: entry.state || null,
                stateCode: entry.state_code ?? entry.stateCode ?? null,
                message: this._extractIncidentMessage(entry),
                updated: entry.updated || entry.updated_at || null,
                components: this._extractIncidentComponents(entry),
            }));
    }

    _normalizeMaintenance(maintenanceField) {
        if (!maintenanceField || typeof maintenanceField !== 'object') {
            return { active: [], upcoming: [] };
        }
        const mapEntry = (entry) => ({
            id: entry?.id || null,
            name: entry?.name || 'Maintenance',
            status: entry?.status || null,
            statusCode: entry?.status_code ?? null,
            message: this._extractIncidentMessage(entry),
            updated: entry?.updated || null,
            components: this._extractIncidentComponents(entry),
        });
        return {
            active: Array.isArray(maintenanceField.active) ? maintenanceField.active.map(mapEntry) : [],
            upcoming: Array.isArray(maintenanceField.upcoming) ? maintenanceField.upcoming.map(mapEntry) : [],
        };
    }

    _extractIncidentMessage(entry) {
        if (!entry || typeof entry !== 'object') return '';
        if (typeof entry.message === 'string') return entry.message;
        if (Array.isArray(entry.messages) && entry.messages.length > 0) {
            const latest = entry.messages[entry.messages.length - 1];
            if (typeof latest === 'string') return latest;
            if (latest && typeof latest.details === 'string') return latest.details;
            if (latest && typeof latest.message === 'string') return latest.message;
        }
        if (typeof entry.details === 'string') return entry.details;
        return '';
    }

    _extractIncidentComponents(entry) {
        if (!entry || typeof entry !== 'object') return [];
        if (Array.isArray(entry.components)) {
            return entry.components.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
        }
        if (Array.isArray(entry.containers)) {
            return entry.containers.map((c) => c?.name).filter(Boolean);
        }
        return [];
    }

    _getComponent(payload, name) {
        return payload?.components?.find((c) => c.name === name) || null;
    }

    _isImageGenerationBlocked(payload) {
        const component = this._getComponent(payload, 'Image Generation');
        if (!component || component.statusCode == null) {
            return false;
        }
        return component.statusCode >= STATUS_CODE.PARTIAL;
    }

    _selectActiveIncident(payload) {
        const impairedComponents = (payload.components || []).filter((c) => c.impaired);
        if (impairedComponents.length === 0) {
            return null;
        }

        impairedComponents.sort((a, b) => {
            const pa = COMPONENT_PRIORITY[a.name] ?? 99;
            const pb = COMPONENT_PRIORITY[b.name] ?? 99;
            if (pa !== pb) return pa - pb;
            return (b.statusCode || 0) - (a.statusCode || 0);
        });

        const primary = impairedComponents[0];
        const incidentMatch = this._findIncidentForComponent(payload, primary.name);
        const incidentKey = incidentMatch?.id
            || `${primary.name}:${primary.statusCode}:${primary.updated || ''}`;

        return {
            key: incidentKey,
            component: primary.name,
            status: primary.status,
            statusCode: primary.statusCode,
            message: incidentMatch?.message || `${primary.name} — ${primary.status}`,
            incidentId: incidentMatch?.id || null,
            severity: primary.outage ? 'outage' : (primary.statusCode >= STATUS_CODE.MAINTENANCE ? 'maintenance' : 'degraded'),
        };
    }

    _findIncidentForComponent(payload, componentName) {
        const incidents = payload.incidents || [];
        for (const incident of incidents) {
            if (incident.components?.includes(componentName)) {
                return incident;
            }
        }
        const activeMaintenance = payload.maintenance?.active || [];
        for (const entry of activeMaintenance) {
            if (entry.components?.includes(componentName)) {
                return entry;
            }
        }
        return null;
    }

    _buildFallbackPayload(errorMessage) {
        return {
            fetchedAt: new Date().toISOString(),
            fetchError: errorMessage,
            stale: true,
            overall: null,
            components: MONITORED_COMPONENTS.map((name) => ({
                id: null,
                name,
                status: 'Unknown',
                statusCode: null,
                updated: null,
                impaired: false,
                outage: false,
            })),
            incidents: [],
            maintenance: { active: [], upcoming: [] },
        };
    }
}

module.exports = {
    NovelAiStatusMonitor,
    MONITORED_COMPONENTS,
    COMPONENT_PRIORITY,
    STATUS_CODE,
};
