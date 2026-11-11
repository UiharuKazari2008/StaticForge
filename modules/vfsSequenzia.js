/**
 * Sequenzia as a network drive in the VFS (Yozora #749). Explorer shows it under Computer; the
 * folders are Sequenzia's own tree (superclass > class > channel > virtual folder) and the files are
 * its records. Everything goes through Sequenzia's client API (/api/v1, Sequenzia-Web routes/api.js)
 * as one Sequenzia user, with the exchange key held here and never sent to the browser.
 *
 * Config: <.cache>/packages/.data/sequenzia/config.json  { url, exchange, key, user }
 *
 * Paths (handed over by vfsManager.listDirectory / getPathStats / getPathDisplayInfo /
 * resolvePathInput, typed 'sequenzia' by parsePath, read-only for now):
 *   /~sequenzia                                   the superclasses
 *   /~sequenzia/<super>                           its classes
 *   /~sequenzia/<super>/<class>                   its channels
 *   /~sequenzia/<super>/<class>/c<channel id>     the channel's virtual folders and files
 *   .../c<channel id>/f<fid>                      one virtual folder
 *
 * Items: folders are targetKind 'sequenzia-folder' with a navPath; files are 'sequenzia-entry'
 * with downloadUrl / viewUrl (bytes, with Range) and previewUrl (the CDN's small preview).
 * `size` is exact when Sequenzia has the byte count, otherwise the legacy MB figure (sizeApprox).
 *
 * Only administrators see the drive: it carries one person's Sequenzia rights.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = '/~sequenzia';
const DRIVE_NAME = 'Sequenzia';
const TREE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 30000;
const USER_AGENT = 'Dreamscape/1.0 (vfsSequenzia)';
const PREVIEW_PATH = /^(preview|extended_preview)\/[\w-]+\/[\w-]+\/[\w.\-]+$/;

const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', avif: 'image/avif', svg: 'image/svg+xml',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ts: 'video/mp2t',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', aiff: 'audio/aiff',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', pdf: 'application/pdf',
    zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', iso: 'application/x-iso9660-image'
};

function mimeForName(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return MIME[ext] || 'application/octet-stream';
}

function sequenziaError(code, message, status) {
    return Object.assign(new Error(message), { code, status });
}

class VfsSequenzia {
    constructor(vfsManager) {
        this.vfs = vfsManager;
        this.gr = vfsManager.globalResources;
        this._config = null;
        this._cookie = null;
        this._tree = null;
        this._who = null;
    }

    // ---- config and transport ----------------------------------------------------------------

    configFile() {
        const dir = process.env.SEQUENZIA_DATA_DIR || path.join(__dirname, '..', '.cache', 'packages', '.data', 'sequenzia');
        return path.join(dir, 'config.json');
    }

    config() {
        const file = this.configFile();
        let st;
        try { st = fs.statSync(file); } catch (_) { return null; }
        if (!this._config || this._config.mtimeMs !== st.mtimeMs) {
            let data;
            try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
            if (!data || !/^https?:\/\//i.test(String(data.url || '')) || !data.exchange || !data.key || !data.user) return null;
            this._config = { mtimeMs: st.mtimeMs, url: String(data.url).replace(/\/+$/, ''), exchange: String(data.exchange), key: String(data.key), user: String(data.user) };
            this._cookie = null;
            this._tree = null;
            this._who = null;
        }
        return this._config;
    }

    isConfigured() {
        return !!this.config();
    }

    headers(extra = {}) {
        const cfg = this.config();
        if (!cfg) throw sequenziaError('SEQUENZIA_NO_CONFIG', 'Sequenzia is not set up on this server.', 503);
        const h = {
            'User-Agent': USER_AGENT,
            'x-sequenzia-exchange': cfg.exchange,
            'x-sequenzia-key': cfg.key,
            'x-sequenzia-user': cfg.user,
            ...extra
        };
        // one Sequenzia session for this server, not one per request
        if (this._cookie) h.Cookie = this._cookie;
        return h;
    }

    rememberCookie(response) {
        const set = response.headers['set-cookie'];
        if (!set || !set.length) return;
        const pair = set.map((c) => String(c).split(';')[0]).find((c) => c.startsWith('UserSession='));
        if (pair) this._cookie = pair;
    }

    /** One API call, JSON back. */
    api(apiPath) {
        return new Promise((resolve, reject) => {
            let cfg;
            let headers;
            try { cfg = this.config(); headers = this.headers({ Accept: 'application/json' }); } catch (e) { return reject(e); }
            const url = `${cfg.url}/api/v1${apiPath}`;
            const client = url.startsWith('https') ? https : http;
            const request = client.get(url, { headers, timeout: TIMEOUT_MS }, (response) => {
                this.rememberCookie(response);
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => { body += chunk; });
                response.on('end', () => {
                    let data = null;
                    try { data = JSON.parse(body); } catch (_) { /* not JSON */ }
                    if (response.statusCode >= 200 && response.statusCode < 300 && data) return resolve(data);
                    const message = (data && data.message) || `Sequenzia answered ${response.statusCode}`;
                    reject(sequenziaError('SEQUENZIA_HTTP', message, response.statusCode === 404 ? 404 : 502));
                });
            });
            request.on('timeout', () => request.destroy(sequenziaError('SEQUENZIA_TIMEOUT', 'Sequenzia did not answer in time.', 504)));
            request.on('error', (e) => reject(e.code && String(e.code).startsWith('SEQUENZIA') ? e : sequenziaError('SEQUENZIA_UNREACHABLE', `Sequenzia cannot be reached (${e.code || e.message}).`, 502)));
        });
    }

    async tree() {
        if (this._tree && Date.now() - this._tree.at < TREE_TTL_MS) return this._tree.data;
        const data = (await this.api('/tree')).tree || [];
        this._tree = { at: Date.now(), data };
        return data;
    }

    async whoami() {
        if (this._who && Date.now() - this._who.at < 10 * 60 * 1000) return this._who.data;
        const data = await this.api('/whoami');
        this._who = { at: Date.now(), data };
        return data;
    }

    /** What Computer shows for the drive: { configured, online, name, user, error } */
    async status() {
        if (!this.isConfigured()) return { configured: false, online: false, name: DRIVE_NAME };
        try {
            const who = await this.whoami();
            return { configured: true, online: true, name: DRIVE_NAME, path: ROOT, user: who.name, channels: who.channels };
        } catch (e) {
            return { configured: true, online: false, name: DRIVE_NAME, path: ROOT, error: e.message };
        }
    }

    // ---- paths ---------------------------------------------------------------------------------

    isPath(vfsPath) {
        return typeof vfsPath === 'string' && (vfsPath === ROOT || vfsPath.startsWith(`${ROOT}/`));
    }

    splitPath(vfsPath) {
        const normalized = this.vfs.normalizePath(vfsPath);
        if (!this.isPath(normalized)) return null;
        let parts;
        try {
            parts = normalized.slice(ROOT.length).split('/').filter(Boolean).map((s) => decodeURIComponent(s));
        } catch (_) {
            return null;
        }
        if (parts.length > 4) return null;
        const loc = { path: normalized, superId: parts[0] || null, classId: parts[1] || null, channelId: null, fid: null, depth: parts.length };
        if (parts[2]) {
            if (!/^c\d+$/.test(parts[2])) return null;
            loc.channelId = parts[2].slice(1);
        }
        if (parts[3]) {
            if (!/^f\d+$/.test(parts[3])) return null;
            loc.fid = parseInt(parts[3].slice(1), 10);
        }
        return loc;
    }

    buildPath(...segments) {
        return ROOT + segments.filter((s) => s !== null && s !== undefined && s !== '').map((s) => `/${encodeURIComponent(s)}`).join('');
    }

    /** The tree nodes a path names: { loc, sup, cls, channel, folder }. Throws when one is missing. */
    async resolve(vfsPath) {
        const loc = this.splitPath(vfsPath);
        if (!loc) throw sequenziaError('NOT_FOUND', 'This folder does not exist on Sequenzia.', 404);
        const tree = await this.tree();
        const out = { loc, tree, sup: null, cls: null, channel: null, folder: null };
        if (loc.superId) {
            out.sup = tree.find((s) => s.id === loc.superId);
            if (!out.sup) throw sequenziaError('NOT_FOUND', 'This folder does not exist on Sequenzia.', 404);
        }
        if (loc.classId) {
            out.cls = out.sup.classes.find((c) => c.id === loc.classId);
            if (!out.cls) throw sequenziaError('NOT_FOUND', 'This folder does not exist on Sequenzia.', 404);
        }
        if (loc.channelId) {
            out.channel = out.cls.channels.find((c) => c.id === loc.channelId);
            if (!out.channel) throw sequenziaError('NOT_FOUND', 'This folder does not exist on Sequenzia.', 404);
        }
        if (loc.fid !== null) {
            out.folder = (out.channel.folders || []).find((f) => f.fid === loc.fid);
            if (!out.folder) throw sequenziaError('NOT_FOUND', 'This folder does not exist on Sequenzia.', 404);
        }
        return out;
    }

    /** Two channels of a class can share a name on different servers: the server's short name tells them apart. */
    channelLabel(cls, channel) {
        const same = cls.channels.filter((c) => c.name === channel.name);
        return same.length > 1 && channel.server_short_name ? `${channel.name} (${channel.server_short_name})` : channel.name;
    }

    // ---- items ---------------------------------------------------------------------------------

    folderItem(name, navPath, extra = {}) {
        return {
            id: `seq:dir:${navPath}`,
            name,
            kind: 'folder',
            targetKind: 'sequenzia-folder',
            targetId: navPath,
            navPath,
            icon: 'fas fa-folder',
            system: false,
            protected: true,
            importable: false,
            size: 0,
            typeLabel: 'File Folder',
            ...extra
        };
    }

    fileUrl(eid, name, inline) {
        const uuid = this.gr.getVfsPathUuid();
        return `/${uuid}/sequenzia/file/${eid}/${encodeURIComponent(name)}${inline ? '?inline=1' : ''}`;
    }

    fileItem(record) {
        const mime = mimeForName(record.name);
        const exact = record.bytes !== null && record.bytes !== undefined;
        const size = exact ? record.bytes : (record.approx_bytes || 0);
        const item = {
            id: `seq:${record.eid}`,
            name: record.name,
            kind: 'file',
            targetKind: 'sequenzia-entry',
            targetId: String(record.eid),
            sequenziaEid: record.eid,
            sequenziaChannel: record.channel,
            mimeType: mime,
            icon: mime.startsWith('image/') ? 'fas fa-file-image' : 'fas fa-file',
            system: false,
            protected: true,
            importable: false,
            size,
            sizeBytes: size,
            sizeApprox: !exact,
            modifiedAt: record.date,
            downloadUrl: this.fileUrl(record.eid, record.name, false),
            viewUrl: this.fileUrl(record.eid, record.name, true)
        };
        if (record.width && record.height) {
            item.width = record.width;
            item.height = record.height;
        }
        if (record.preview && PREVIEW_PATH.test(record.preview.path)) {
            item.previewUrl = `/${this.gr.getVfsPathUuid()}/sequenzia/preview/${record.preview.host}/${record.preview.path}`;
        }
        return item;
    }

    apiSort(sortField, sortDirection) {
        const field = String(sortField || 'name').toLowerCase();
        const sort = field.includes('size') ? 'size' : (field.includes('modif') || field.includes('date')) ? 'date' : field.includes('type') ? 'type' : 'name';
        return `sort=${sort}&dir=${sortDirection === 'desc' ? 'desc' : 'asc'}`;
    }

    // ---- vfsManager's calls --------------------------------------------------------------------

    async listDirectory(vfsPath, options = {}) {
        const { offset = 0, limit = 300, sortField = 'name', sortDirection = 'asc', search = '' } = options;
        const { loc, tree, sup, cls, channel, folder } = await this.resolve(vfsPath);
        const base = { path: loc.path, totalSizeBytes: 0, emptyMessage: 'This folder is empty.', sequenzia: true };

        if (!channel) {
            let items;
            if (!sup) items = tree.map((s) => this.folderItem(s.name, this.buildPath(s.id)));
            else if (!cls) items = sup.classes.map((c) => this.folderItem(c.name, this.buildPath(sup.id, c.id)));
            else items = cls.channels.map((c) => this.folderItem(this.channelLabel(cls, c), this.buildPath(sup.id, cls.id, `c${c.id}`), { sequenziaChannel: c.id, sequenziaNsfw: !!c.nsfw }));
            items = this.vfs.filterItems(items, search);
            items = this.vfs.sortItems(items, 'name', sortField === 'name' && sortDirection === 'desc' ? 'desc' : 'asc');
            const page = this.vfs.paginateItems(items, offset, limit);
            return { ...base, items: page.items, totalCount: items.length, hasMore: page.hasMore };
        }

        const channelFolders = channel.folders || [];
        const term = String(search || '').trim();
        // a channel's own listing holds its virtual folders and the files in none of them
        let folders = [];
        if (!folder && !term && offset === 0) {
            folders = channelFolders.map((f) => this.folderItem(f.name, this.buildPath(sup.id, cls.id, `c${channel.id}`, `f${f.fid}`)));
        }
        const pageSize = Math.max(1, Math.min(1000, Number(limit) || 300));
        // Explorer pages by the number of items it holds; the folders shown on the first page are not records
        const shownFolders = (!folder && !term) ? channelFolders.length : 0;
        const recordOffset = Math.max(0, (Number(offset) || 0) - (offset > 0 ? shownFolders : 0));
        const query = [`channel=${encodeURIComponent(channel.id)}`, `offset=${recordOffset}`, `limit=${pageSize}`, 'files=1', this.apiSort(sortField, sortDirection)];
        if (folder) query.push(`fid=${folder.fid}`);
        else if (channelFolders.length && !term) query.push('fid=none');
        let reply;
        if (term) {
            query.push(`name=${encodeURIComponent(term)}`);
            reply = await this.api(`/search?${query.join('&')}`);
            if (folder) reply.items = reply.items.filter((r) => r.fid === folder.fid);
        } else {
            reply = await this.api(`/list?${query.join('&')}`);
        }
        // records with no file of their own (plain text posts) are not files on a drive
        const files = (reply.items || []).filter((r) => r.name && r.source && r.source.kind !== 'none').map((r) => this.fileItem(r));
        return {
            ...base,
            items: folders.concat(files),
            hasMore: !!reply.more,
            totalSizeBytes: files.reduce((sum, f) => sum + (f.size || 0), 0)
        };
    }

    async getPathDisplayInfo(vfsPath) {
        const { loc, sup, cls, channel, folder } = await this.resolve(vfsPath);
        const segments = [{ label: DRIVE_NAME, canonical: ROOT }];
        if (sup) segments.push({ label: sup.name, canonical: this.buildPath(sup.id) });
        if (cls) segments.push({ label: cls.name, canonical: this.buildPath(sup.id, cls.id) });
        if (channel) segments.push({ label: this.channelLabel(cls, channel), canonical: this.buildPath(sup.id, cls.id, `c${channel.id}`) });
        if (folder) segments.push({ label: folder.name, canonical: loc.path });
        return {
            displayName: segments[segments.length - 1].label,
            // labels are joined with "/" and split again by the breadcrumb, so a "/" in a name becomes a look-alike
            displayPath: '/' + segments.map((s) => String(s.label).replace(/\//g, '∕')).join('/'),
            segments
        };
    }

    async getPathStats(vfsPath) {
        const { loc, tree, sup, cls, channel } = await this.resolve(vfsPath);
        const display = await this.getPathDisplayInfo(loc.path);
        let itemCount = null;
        let totalSizeBytes = 0;
        if (!sup) itemCount = tree.length;
        else if (!cls) itemCount = sup.classes.length;
        else if (!channel) itemCount = cls.channels.length;
        else {
            // a channel or one of its folders: Sequenzia counts the files and adds up their sizes
            const totals = await this.folderTotals(loc, channel);
            itemCount = totals.count;
            totalSizeBytes = totals.bytes;
        }
        return {
            path: loc.path,
            displayName: display.displayName,
            displayPath: display.displayPath,
            itemCount,
            totalSizeBytes,
            selectedCount: 0,
            sequenzia: { channel: channel ? channel.id : null, writable: false }
        };
    }

    /** { count, bytes } for a channel listing (its folders counted as items) or one virtual folder. Cached a minute. */
    async folderTotals(loc, channel) {
        if (!this._totals) this._totals = new Map();
        const hit = this._totals.get(loc.path);
        if (hit && Date.now() - hit.at < TREE_TTL_MS) return hit.data;
        const folders = channel.folders || [];
        const query = [`channel=${encodeURIComponent(channel.id)}`, 'files=1', 'limit=1', 'total=1'];
        if (loc.fid !== null) query.push(`fid=${loc.fid}`);
        else if (folders.length) query.push('fid=none');
        let data = { count: null, bytes: 0 };
        try {
            const reply = await this.api(`/list?${query.join('&')}`);
            data = { count: (Number(reply.total) || 0) + (loc.fid === null ? folders.length : 0), bytes: Number(reply.total_bytes) || 0 };
        } catch (_) { /* the listing itself reports a failure; the count just stays unknown */ }
        this._totals.set(loc.path, { at: Date.now(), data });
        if (this._totals.size > 500) this._totals.delete(this._totals.keys().next().value);
        return data;
    }

    // ---- bytes ---------------------------------------------------------------------------------

    /** Pipe an upstream GET to the client with Range passed through. */
    pipe(req, res, url, headers, { filename, inline } = {}) {
        const client = url.startsWith('https') ? https : http;
        const out = { ...headers };
        if (req.headers.range) out.Range = req.headers.range;
        if (req.headers['if-range']) out['If-Range'] = req.headers['if-range'];
        const upstream = client.request(url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: out, timeout: TIMEOUT_MS }, (response) => {
            this.rememberCookie(response);
            if (response.statusCode >= 400 && response.statusCode !== 416) {
                response.resume();
                return res.status(response.statusCode === 404 ? 404 : 502).send(response.statusCode === 404 ? 'Not found' : 'Sequenzia could not send this file');
            }
            res.status(response.statusCode);
            for (const h of ['content-length', 'content-range', 'last-modified', 'etag']) {
                if (response.headers[h]) res.setHeader(h, response.headers[h]);
            }
            const upstreamType = response.headers['content-type'];
            const named = filename ? mimeForName(filename) : null;
            res.setHeader('Content-Type', named && named !== 'application/octet-stream' ? named : (upstreamType || 'application/octet-stream'));
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            if (filename) res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);
            response.pipe(res);
            res.on('close', () => response.destroy());
        });
        upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
        upstream.on('error', () => { if (!res.headersSent) res.status(502).send('Sequenzia cannot be reached'); else res.destroy(); });
        upstream.end();
    }

    streamFile(req, res, eid, name, inline) {
        const cfg = this.config();
        if (!cfg) return res.status(503).send('Sequenzia is not set up on this server.');
        this.pipe(req, res, `${cfg.url}/api/v1/read/${eid}`, this.headers(), { filename: name, inline });
    }

    async streamPreview(req, res, host, previewPath) {
        if (!PREVIEW_PATH.test(previewPath)) return res.status(400).send('Bad preview path');
        const who = await this.whoami();
        const cdn = (who.cdn || []).find((c) => String(c.id) === String(host));
        if (!cdn || !/^https?:\/\//i.test(String(cdn.local_url || ''))) return res.status(404).send('Not found');
        this.pipe(req, res, cdn.local_url.replace(/\/+$/, '') + '/' + previewPath, { 'User-Agent': USER_AGENT }, {});
    }
}

function registerSequenziaRoutes(app, { vfsPath, authMiddleware, globalResources, buildVfsSession }) {
    const seq = () => globalResources.getVfsManager().getSequenzia();
    const adminOnly = (req, res) => {
        if (buildVfsSession(req).userType !== 'admin') { res.status(403).send('Access denied'); return false; }
        return true;
    };
    app.get(`${vfsPath}/sequenzia/status`, authMiddleware, async (req, res) => {
        if (buildVfsSession(req).userType !== 'admin') return res.json({ success: true, status: { configured: false, online: false } });
        try {
            res.json({ success: true, status: await seq().status() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.get(`${vfsPath}/sequenzia/file/:eid/:name`, authMiddleware, (req, res) => {
        if (!adminOnly(req, res)) return;
        if (!/^\d{1,12}$/.test(req.params.eid)) return res.status(400).send('Bad file id');
        try {
            seq().streamFile(req, res, req.params.eid, String(req.params.name || ''), req.query.inline === '1');
        } catch (e) {
            if (!res.headersSent) res.status(e.status || 500).send(e.message);
        }
    });
    app.get(`${vfsPath}/sequenzia/preview/:host/*`, authMiddleware, async (req, res) => {
        if (!adminOnly(req, res)) return;
        try {
            await seq().streamPreview(req, res, req.params.host, String(req.params[0] || ''));
        } catch (e) {
            if (!res.headersSent) res.status(e.status || 502).send(e.message);
        }
    });
}

module.exports = { VfsSequenzia, registerSequenziaRoutes, ROOT, DRIVE_NAME, _test: { mimeForName } };
