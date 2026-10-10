/**
 * Durable index of generation requests (MCP generate_image / generate_preset and Studio FIFO).
 * The in-memory job queue expires; this log keeps job id, caller, workspace, and gallery URLs.
 * Gallery URLs are authenticated MCP downloads — they do not use the 15-minute artifact ticket.
 */

const fs = require('fs');
const path = require('path');
const { resolveMcpPublicBaseUrl } = require('./mcpServerInfo');

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const MAX_RECORDS = 2000;
const LOG_FILENAME = 'generation_requests.json';

const stores = new Map();

function clip(value, max) {
    if (value == null) return '';
    const text = String(value).replace(/[\r\n\0]/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? text.slice(0, max) : text;
}

function parseTime(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
        const n = Number(text);
        return Number.isFinite(n) ? n : null;
    }
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
}

function requireTime(value, label) {
    if (value == null || value === '') return null;
    const parsed = parseTime(value);
    if (parsed == null) {
        const err = new Error(`${label} must be an ISO time or epoch milliseconds`);
        err.status = 400;
        err.code = 'BAD_TIME';
        throw err;
    }
    return parsed;
}

function safeGalleryFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw || raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return '';
    const base = path.basename(raw);
    if (!base || base !== raw || base === '.' || base === '..') return '';
    return base;
}

function cleanImageIds(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const out = [];
    list.forEach((item) => {
        const name = safeGalleryFilename(typeof item === 'string' ? item : item && item.filename);
        if (name && !out.includes(name)) out.push(name);
    });
    return out.slice(0, 32);
}

function cleanImageUrls(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const out = [];
    list.forEach((item) => {
        const url = String(item || '').trim();
        if (!/^https?:\/\//i.test(url) || url.length > 500) return;
        if (!out.includes(url)) out.push(url);
    });
    return out.slice(0, 32);
}

function iso(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return null;
    return new Date(Number(ms)).toISOString();
}

function publicRecord(row) {
    return {
        jobId: row.jobId,
        status: row.status,
        type: row.type,
        source: row.source,
        caller: row.caller || null,
        callerId: row.callerId || null,
        workspace: row.workspace || null,
        createdAt: iso(row.createdAt),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
        imageIds: row.imageIds.slice(),
        imageUrls: row.imageUrls.slice(),
        error: row.error || null
    };
}

function createGenerationRequestLog(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const filePath = opts.filePath ? String(opts.filePath) : '';
    const nowFn = opts.now || Date.now;
    const records = new Map();

    function persist() {
        if (!filePath) return;
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${filePath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(Array.from(records.values())));
        fs.renameSync(tmp, filePath);
    }

    function load() {
        if (!filePath || !fs.existsSync(filePath)) return;
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!Array.isArray(parsed)) return;
            parsed.forEach((row) => {
                if (!row || !row.jobId) return;
                records.set(String(row.jobId), {
                    jobId: String(row.jobId),
                    status: String(row.status || 'queued'),
                    type: String(row.type || 'generate_image'),
                    source: String(row.source || 'unknown'),
                    caller: clip(row.caller, 200),
                    callerId: clip(row.callerId, 80),
                    workspace: clip(row.workspace, 120),
                    createdAt: parseTime(row.createdAt) || 0,
                    startedAt: parseTime(row.startedAt),
                    finishedAt: parseTime(row.finishedAt),
                    imageIds: cleanImageIds(row.imageIds),
                    imageUrls: cleanImageUrls(row.imageUrls),
                    error: row.error ? clip(row.error, 300) : null
                });
            });
        } catch (_err) {
            records.clear();
        }
    }

    function trim() {
        if (records.size <= MAX_RECORDS) return;
        const ordered = Array.from(records.values()).sort((a, b) => a.createdAt - b.createdAt);
        while (records.size > MAX_RECORDS && ordered.length) {
            const drop = ordered.shift();
            if (drop) records.delete(drop.jobId);
        }
    }

    load();

    function remember(input) {
        const src = input && typeof input === 'object' ? input : {};
        const jobId = clip(src.jobId, 80);
        if (!jobId) {
            const err = new Error('jobId is required');
            err.status = 400;
            throw err;
        }
        const existing = records.get(jobId);
        const row = {
            jobId,
            status: clip(src.status, 40) || (existing && existing.status) || 'queued',
            type: clip(src.type, 80) || (existing && existing.type) || 'generate_image',
            source: clip(src.source, 40) || (existing && existing.source) || 'unknown',
            caller: src.caller != null ? clip(src.caller, 200) : ((existing && existing.caller) || ''),
            callerId: src.callerId != null ? clip(src.callerId, 80) : ((existing && existing.callerId) || ''),
            workspace: src.workspace != null ? clip(src.workspace, 120) : ((existing && existing.workspace) || ''),
            createdAt: parseTime(src.createdAt) || (existing && existing.createdAt) || nowFn(),
            startedAt: src.startedAt !== undefined ? parseTime(src.startedAt) : (existing && existing.startedAt) || null,
            finishedAt: src.finishedAt !== undefined ? parseTime(src.finishedAt) : (existing && existing.finishedAt) || null,
            imageIds: src.imageIds !== undefined ? cleanImageIds(src.imageIds) : ((existing && existing.imageIds) || []),
            imageUrls: src.imageUrls !== undefined ? cleanImageUrls(src.imageUrls) : ((existing && existing.imageUrls) || []),
            error: Object.prototype.hasOwnProperty.call(src, 'error')
                ? (src.error ? clip(src.error, 300) : null)
                : ((existing && existing.error) || null)
        };
        records.set(jobId, row);
        trim();
        persist();
        return row;
    }

    function list(query, decorate) {
        const q = query && typeof query === 'object' ? query : {};
        const caller = clip(q.caller, 200).toLowerCase();
        const workspace = clip(q.workspace || q.workspaceId, 120);
        const since = requireTime(q.since, 'since');
        const until = requireTime(q.until, 'until');
        let rows = Array.from(records.values());
        if (caller) {
            rows = rows.filter((row) => {
                const name = String(row.caller || '').toLowerCase();
                const id = String(row.callerId || '').toLowerCase();
                return name.includes(caller) || id === caller;
            });
        }
        if (workspace) {
            rows = rows.filter((row) => String(row.workspace || '') === workspace);
        }
        if (since != null) rows = rows.filter((row) => row.createdAt >= since);
        if (until != null) rows = rows.filter((row) => row.createdAt <= until);
        rows.sort((a, b) => b.createdAt - a.createdAt || String(b.jobId).localeCompare(String(a.jobId)));
        const total = rows.length;
        const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
        let limit = Math.floor(Number(q.limit));
        if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PAGE_LIMIT;
        limit = Math.min(MAX_PAGE_LIMIT, limit);
        const page = rows.slice(offset, offset + limit).map((row) => {
            const copy = {
                ...row,
                imageIds: row.imageIds.slice(),
                imageUrls: row.imageUrls.slice()
            };
            return typeof decorate === 'function' ? decorate(copy) : copy;
        });
        return {
            requests: page.map(publicRecord),
            total,
            offset,
            limit
        };
    }

    return { filePath, remember, list, _records: records };
}

function logLocation(globalResources) {
    let filePath = '';
    try {
        if (globalResources && typeof globalResources.getPath === 'function') {
            filePath = path.join(globalResources.getPath('cache'), LOG_FILENAME);
        }
    } catch (_err) {
        filePath = '';
    }
    return { key: filePath || ':memory:', filePath };
}

function getGenerationRequestLog(globalResources) {
    const loc = logLocation(globalResources);
    let store = stores.get(loc.key);
    if (!store) {
        store = createGenerationRequestLog({ filePath: loc.filePath });
        stores.set(loc.key, store);
    }
    return store;
}

function resetGenerationRequestLogsForTests() {
    stores.clear();
}

function buildDurableGalleryImageUrl(globalResources, filename) {
    const safe = safeGalleryFilename(filename);
    if (!safe || !globalResources) return '';
    let uuid = '';
    try {
        uuid = typeof globalResources.getMcpPathUuid === 'function'
            ? String(globalResources.getMcpPathUuid() || '')
            : '';
    } catch (_err) {
        uuid = '';
    }
    if (!uuid) return '';
    const base = resolveMcpPublicBaseUrl(globalResources).replace(/\/$/, '');
    return `${base}/${uuid}/gallery/${encodeURIComponent(safe)}`;
}

function urlsForFilenames(globalResources, filenames) {
    return cleanImageIds(filenames)
        .map((name) => buildDurableGalleryImageUrl(globalResources, name))
        .filter(Boolean);
}

function rememberGenerationRequest(globalResources, row) {
    return getGenerationRequestLog(globalResources).remember(row);
}

function patchGenerationRequest(globalResources, jobId, patch) {
    const src = patch && typeof patch === 'object' ? patch : {};
    return getGenerationRequestLog(globalResources).remember({ jobId, ...src });
}

const TERMINAL_REQUEST_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function overlayLiveJob(queue, row) {
    if (!queue || typeof queue.get !== 'function') return row;
    const job = queue.get(row.jobId);
    if (!job || typeof queue.snapshot !== 'function') return row;
    const snap = queue.snapshot(job);
    const next = { ...row };
    if (!TERMINAL_REQUEST_STATUSES.has(next.status) && snap.status) {
        next.status = snap.status;
        if (snap.startedAt) next.startedAt = snap.startedAt;
        if (snap.finishedAt) next.finishedAt = snap.finishedAt;
        if (snap.error) next.error = snap.error;
    }
    if ((!next.imageIds || !next.imageIds.length) && snap.filename) {
        next.imageIds = cleanImageIds([snap.filename].concat(snap.filenames || []));
    }
    return next;
}

function queryGenerationRequests(globalResources, query) {
    const log = getGenerationRequestLog(globalResources);
    let queue = null;
    try {
        queue = globalResources && typeof globalResources.getGenerationJobQueue === 'function'
            ? globalResources.getGenerationJobQueue()
            : null;
    } catch (_err) {
        queue = null;
    }
    const page = log.list(query, (row) => overlayLiveJob(queue, row));
    page.requests = page.requests.map((row) => {
        if (row.imageUrls && row.imageUrls.length) return row;
        const imageUrls = urlsForFilenames(globalResources, row.imageIds);
        return { ...row, imageUrls };
    });
    return page;
}

function scopesAllow(scopes, allowed) {
    if (!Array.isArray(scopes) || scopes.length === 0) return false;
    if (scopes.includes('universal')) return true;
    return allowed.some((id) => scopes.includes(id));
}

function handleGenerationRequestsHttp(globalResources, req, res) {
    const scopes = req && req.applicationAuth && req.applicationAuth.applicationScopes;
    if (!scopesAllow(scopes, ['generation'])) {
        res.status(403).json({ success: false, error: 'Access denied', code: 'INSUFFICIENT_SCOPE' });
        return;
    }
    try {
        const page = queryGenerationRequests(globalResources, (req && req.query) || {});
        res.status(200).json({ success: true, ...page });
    } catch (err) {
        const status = err && err.status ? err.status : 500;
        res.status(status).json({
            success: false,
            error: status >= 500 ? 'Failed to list generation requests' : (err.message || 'Failed to list generation requests'),
            code: err && err.code ? err.code : undefined
        });
    }
}

function handleMcpGalleryImageDownload(globalResources, req, res) {
    const scopes = req && req.applicationAuth && req.applicationAuth.applicationScopes;
    if (!scopesAllow(scopes, ['generation', 'gallery'])) {
        res.status(403).json({ success: false, error: 'Access denied', code: 'INSUFFICIENT_SCOPE' });
        return;
    }
    const filename = safeGalleryFilename(req && req.params && req.params.filename);
    if (!filename) {
        res.status(400).json({ success: false, error: 'filename must be a gallery basename' });
        return;
    }
    let imagesDir = '';
    try {
        imagesDir = path.resolve(globalResources.getPath('images'));
    } catch (_err) {
        res.status(500).json({ success: false, error: 'Images directory is not configured' });
        return;
    }
    const filePath = path.resolve(imagesDir, filename);
    if (filePath !== imagesDir && !filePath.startsWith(imagesDir + path.sep)) {
        res.status(400).json({ success: false, error: 'filename must be a gallery basename' });
        return;
    }
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (_err) {
        res.status(404).json({ success: false, error: 'Image not found' });
        return;
    }
    if (!stat.isFile()) {
        res.status(404).json({ success: false, error: 'Image not found' });
        return;
    }
    const ext = path.extname(filename).toLowerCase();
    const mime = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Length', String(stat.size));
    const headerName = filename.replace(/["\r\n]/g, '');
    res.setHeader('Content-Disposition', `inline; filename="${headerName}"`);
    res.status(200).send(fs.readFileSync(filePath));
}

module.exports = {
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    MAX_RECORDS,
    LOG_FILENAME,
    createGenerationRequestLog,
    getGenerationRequestLog,
    resetGenerationRequestLogsForTests,
    buildDurableGalleryImageUrl,
    urlsForFilenames,
    rememberGenerationRequest,
    patchGenerationRequest,
    queryGenerationRequests,
    handleGenerationRequestsHttp,
    handleMcpGalleryImageDownload,
    safeGalleryFilename,
    parseTime
};
