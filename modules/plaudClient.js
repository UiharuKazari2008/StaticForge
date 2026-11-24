'use strict';

/**
 * Plaud account (Yukimi's Plaud recorder): her recordings, their AI notes and transcripts, read for
 * Yozora (Xi) so brainstorming, UI review and live-test recordings become Yozora issues.
 *
 * The account is added in CardSpace (cplAuthentication.js > Install a Managed Service Account > Plaud;
 * WS plaud_account_* in ws/handlers/319-plaudHandler.js). Only the Xi application key reads it, through
 * the plaud_* MCP tools (modules/plaudMcp.js).
 *
 * Plaud's own developer API, the one its CLI and MCP (@plaud-ai/cli, @plaud-ai/mcp) use:
 *   sign-in   https://web.plaud.ai/platform/oauth (OAuth 2 code + PKCE S256, public client: the CLI's)
 *   token     POST https://platform.plaud.ai/developer/api/oauth/third-party/access-token(/refresh)
 *   reads     GET  /open/third-party/users/current, /open/third-party/files/?page&page_size&start_date&end_date,
 *                  /open/third-party/files/<id> (source_list = transcript blocks, note_list = AI notes)
 * The client's redirect is fixed to http://localhost:8199/auth/callback. CardSpace opens the sign-in in the
 * remote browser (grimoire-browser), which runs on this host, so while a sign-in waits the server listens on
 * 127.0.0.1 / ::1 port 8199 and finishes it itself. When the port is taken, or the sign-in ran in a browser
 * on another computer, Yukimi pastes the address that browser went to into CardSpace instead.
 *
 * Tokens live in .cache/plaud-account.json (0600), never in a reply, a log or a tool result.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const http = require('http');

const FILE = process.env.PLAUD_ACCOUNT_FILE || path.join(__dirname, '..', '.cache', 'plaud-account.json');
const AUTH_URL = 'https://web.plaud.ai/platform/oauth';
const API = 'https://platform.plaud.ai/developer/api';
const TOKEN_URL = `${API}/oauth/third-party/access-token`;
const REFRESH_URL = `${API}/oauth/third-party/access-token/refresh`;
const CLIENT_ID = 'client_f9e0b214-c11f-434b-8b95-c4497d1feb81';
const REDIRECT_URI = 'http://localhost:8199/auth/callback';
const CALLBACK_PORT = 8199;
const CALLBACK_PATH = '/auth/callback';
const STATUS_TYPE = 'plaud_account_changed';
const MIN = 60 * 1000;
const LINK_TTL = 15 * MIN;
const TIMEOUT_MS = 20000;
const MAX_BLOCK_BYTES = 20 * 1024 * 1024;
const TRANSCRIPT_PAGE = 60000;
const SEARCH_SCAN_PAGES = 5; // 5 x 100 = the 500 newest recordings, as Plaud's own search
const BLOCKS = ['transaction', 'transaction_polish', 'outline', 'mark_memo'];

let deps = { fetch: (...a) => fetch(...a), lookup: (host) => dns.promises.lookup(host, { all: true }) };
let state = null;      // { user: { access, refresh, until }, account: { name, email, id }, linkedAt }
let loading = null;
let pending = null;    // { state, verifier, until }
let refreshing = null;
let lastError = '';
let listeners = [];    // http servers on 127.0.0.1 / ::1 :8199 while a sign-in waits
let listenTimer = null;
let broadcast = null;  // (status) => void, bound by ws/handlers/319-plaudHandler.js

class PlaudError extends Error {
    constructor(message, code) { super(message); this.code = code || 'PLAUD_ERROR'; }
}

// ------------------------------------------------------------------------------------------ the stored account

async function load() {
    if (state) return state;
    if (!loading) {
        loading = fs.promises.readFile(FILE, 'utf8')
            .then((raw) => JSON.parse(raw))
            .catch(() => null)
            .then((s) => {
                state = { user: s && s.user && s.user.access ? s.user : null, account: (s && s.account) || null, linkedAt: (s && s.linkedAt) || 0 };
                return state;
            })
            .finally(() => { loading = null; });
    }
    return loading;
}

async function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    try {
        await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
        await fs.promises.writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
        await fs.promises.rename(tmp, FILE);
    } catch (e) {
        console.warn(`[plaud] account not saved: ${e.message}`);
    }
}

async function status() {
    const s = await load();
    return {
        linked: !!s.user,
        account: s.user && s.account ? { name: s.account.name || '', email: s.account.email || '' } : null,
        linkedAt: s.user ? s.linkedAt || 0 : 0,
        signingIn: !!(pending && pending.until > Date.now()),
        listening: listeners.length > 0,
        lastError: s.user ? lastError : ''
    };
}

// ------------------------------------------------------------------------------------------ Plaud calls

async function call(url, { method = 'GET', token, form } = {}) {
    let res;
    try {
        res = await deps.fetch(url, {
            method,
            headers: Object.assign({ Accept: 'application/json' },
                token ? { Authorization: `Bearer ${token}` } : {},
                form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
                form && form.code ? { Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:`).toString('base64')}` } : {}),
            body: form ? new URLSearchParams(form).toString() : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (e) {
        throw new PlaudError(`Plaud could not be reached (${e.name === 'TimeoutError' ? 'timed out' : e.message})`, 'PLAUD_NETWORK');
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_e) { body = null; }
    return { status: res.status, body };
}

function tokensFrom(j, keepRefresh) {
    return {
        access: String(j.access_token),
        refresh: String(j.refresh_token || keepRefresh || ''),
        until: Date.now() + (Number(j.expires_in) || 3600) * 1000
    };
}

async function dropLink(reason) {
    const s = await load();
    s.user = null;
    lastError = '';
    await save();
    throw new PlaudError(reason || 'Plaud wants the account signed in again (CardSpace > Plaud).', 'PLAUD_NOT_LINKED');
}

async function accessToken() {
    const s = await load();
    if (!s.user) throw new PlaudError('No Plaud account. Yukimi adds it in CardSpace (Install a Managed Service Account > Plaud).', 'PLAUD_NOT_LINKED');
    if (Date.now() < s.user.until - MIN) return s.user.access;
    if (!s.user.refresh) return dropLink();
    if (!refreshing) {
        refreshing = (async () => {
            const r = await call(REFRESH_URL, { method: 'POST', form: { refresh_token: s.user.refresh } });
            if (r.status === 400 || r.status === 401 || r.status === 403) return dropLink();
            if (r.status !== 200 || !r.body || !r.body.access_token) throw new PlaudError(`Plaud answered ${r.status} to the token refresh`, 'PLAUD_REFUSED');
            s.user = tokensFrom(r.body, s.user.refresh);
            await save();
            return s.user.access;
        })().finally(() => { refreshing = null; });
    }
    return refreshing;
}

async function api(pathAndQuery) {
    let token = await accessToken();
    let r = await call(`${API}${pathAndQuery}`, { token });
    if (r.status === 401) {
        const s = await load();
        if (s.user) s.user.until = 0;
        token = await accessToken();
        r = await call(`${API}${pathAndQuery}`, { token });
        if (r.status === 401) return dropLink();
    }
    if (r.status === 404) throw new PlaudError('Plaud has no recording with that id', 'PLAUD_NOT_FOUND');
    if (r.status !== 200) {
        lastError = `Plaud answered ${r.status}`;
        throw new PlaudError(lastError, 'PLAUD_REFUSED');
    }
    lastError = '';
    return r.body || {};
}

// ------------------------------------------------------------------------------------------ signing in (CardSpace)

function linkStart() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const st = crypto.randomBytes(16).toString('base64url');
    pending = { state: st, verifier, until: Date.now() + LINK_TTL };
    const q = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: st
    });
    void listen();
    return { url: `${AUTH_URL}?${q.toString()}`, redirectUri: REDIRECT_URI, expiresAt: pending.until };
}

// ------------------------------------------------------------------------------------------ the callback on :8199

const PAGE = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>`
    + `<body style="font:12px 'Segoe UI',Tahoma,sans-serif;margin:24px;color:#000"><h1 style="font-size:16px;font-weight:normal;color:#1e3287">${title}</h1><p>${text}</p></body></html>`;

function stopListening() {
    clearTimeout(listenTimer);
    listenTimer = null;
    const old = listeners;
    listeners = [];
    old.forEach((srv) => { try { srv.close(); } catch (_e) { /* already closed */ } });
}

async function notify() {
    if (!broadcast) return;
    try { broadcast(await status()); } catch (e) { console.warn(`[plaud] status push skipped: ${e.message}`); }
}

async function onCallback(req, res) {
    const url = new URL(req.url || '/', REDIRECT_URI);
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) { res.writeHead(404).end(); return; }
    const answer = (code, title, text) => {
        res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(PAGE(title, text));
    };
    // not this sign-in's answer (a stale tab, a guess): leave the waiting sign-in alone
    if (!pending || url.searchParams.get('state') !== pending.state) { answer(400, 'Plaud sign-in', 'This sign-in is no longer waiting. Start it again from CardSpace.'); return; }
    try {
        await linkFinish(url.toString());
        answer(200, 'You are signed in to Plaud', 'Dreamscape CardSpace has the account now. You can close this window.');
    } catch (e) {
        answer(400, 'Plaud sign-in did not finish', `${String(e.message || 'Failed').replace(/[<>&"]/g, '')} Start it again from CardSpace.`);
    }
    stopListening();
    void notify();
}

function listenOn(host) {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => { void onCallback(req, res); });
        srv.once('error', () => resolve(null));
        srv.listen(CALLBACK_PORT, host, () => resolve(srv));
    });
}

async function listen() {
    if (listeners.length) { clearTimeout(listenTimer); } else {
        const got = (await Promise.all(['127.0.0.1', '::1'].map(listenOn))).filter(Boolean);
        if (!pending) { got.forEach((srv) => srv.close()); return; }
        listeners = got;
        if (!got.length) console.warn(`[plaud] port ${CALLBACK_PORT} is taken: the sign-in needs the pasted address`);
    }
    listenTimer = setTimeout(() => { stopListening(); void notify(); }, LINK_TTL);
    if (listenTimer.unref) listenTimer.unref();
}


/** The address the browser landed on after Authorize (or just its code). */
function parsePasted(text) {
    const raw = String(text || '').trim();
    if (!raw) return { code: '', state: '' };
    if (/^[a-z]+:\/\//i.test(raw) || raw.includes('code=')) {
        let q;
        try { q = new URL(raw, REDIRECT_URI).searchParams; } catch (_e) { q = new URLSearchParams(raw.replace(/^[^?]*\?/, '')); }
        return { code: String(q.get('code') || ''), state: String(q.get('state') || ''), error: String(q.get('error') || '') };
    }
    return { code: raw, state: '' };
}

async function linkFinish(pasted) {
    const p = parsePasted(pasted);
    const waiting = pending;
    if (!waiting || waiting.until < Date.now()) { pending = null; throw new PlaudError('That sign-in is no longer waiting. Press Sign in again.', 'PLAUD_LINK_GONE'); }
    if (p.error) { pending = null; throw new PlaudError(`Plaud did not authorize (${p.error})`, 'PLAUD_LINK_REFUSED'); }
    if (!p.code) throw new PlaudError('Paste the address the browser went to after Authorize (it starts with http://localhost:8199).', 'PLAUD_NO_CODE');
    if (p.state && p.state !== waiting.state) throw new PlaudError('That address belongs to another sign-in. Press Sign in again.', 'PLAUD_LINK_GONE');
    pending = null;
    stopListening();
    const r = await call(TOKEN_URL, { method: 'POST', form: { code: p.code, redirect_uri: REDIRECT_URI, code_verifier: waiting.verifier, state: waiting.state } });
    if (r.status !== 200 || !r.body || !r.body.access_token) throw new PlaudError(`Plaud did not finish the sign-in (${r.status})`, 'PLAUD_LINK_REFUSED');
    const s = await load();
    s.user = tokensFrom(r.body);
    s.linkedAt = Date.now();
    s.account = null;
    try {
        const me = await api('/open/third-party/users/current');
        const u = me.data && typeof me.data === 'object' ? me.data : me;
        s.account = { id: String(u.id || u.user_id || ''), name: String(u.nickname || u.name || ''), email: String(u.email || '') };
    } catch (_e) { /* the account works; its name shows next time */ }
    await save();
    return status();
}

function linkCancel() { pending = null; stopListening(); }

async function unlink() {
    const s = await load();
    const had = s.user;
    if (had) { try { await call(`${API}/open/third-party/users/current/revoke`, { method: 'POST', token: had.access }); } catch (_e) { /* forgotten here all the same */ } }
    s.user = null;
    s.account = null;
    s.linkedAt = 0;
    lastError = '';
    pending = null;
    stopListening();
    await save();
    return status();
}

// ------------------------------------------------------------------------------------------ recordings

function dayMs(value, end) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!m) return undefined;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0));
    return d.getTime() - (end ? 1 : 0);
}

function slimFile(f) {
    return {
        id: String(f.id || ''),
        name: String(f.name || ''),
        createdAt: f.created_at || null,
        startAt: f.start_at || null,
        durationMs: Number(f.duration) || 0
    };
}

async function listRecordings(opts) {
    const o = opts || {};
    const query = String(o.query || '').trim().toLowerCase();
    const from = dayMs(o.from);
    const to = dayMs(o.to, true);
    const pageSize = Math.min(100, Math.max(10, Number(o.limit) || 20));
    const params = (page, size) => {
        const q = new URLSearchParams({ page: String(page), page_size: String(size) });
        if (from !== undefined) q.set('start_date', String(from));
        if (to !== undefined) q.set('end_date', String(to));
        return q.toString();
    };
    if (!query) {
        const page = Math.min(1000, Math.max(1, Number(o.page) || 1));
        const r = await api(`/open/third-party/files/?${params(page, pageSize)}`);
        const list = Array.isArray(r.data) ? r.data : [];
        return { page, recordings: list.map(slimFile), more: list.length >= pageSize };
    }
    const hits = [];
    for (let page = 1; page <= SEARCH_SCAN_PAGES && hits.length < pageSize; page++) {
        const r = await api(`/open/third-party/files/?${params(page, 100)}`);
        const list = Array.isArray(r.data) ? r.data : [];
        list.forEach((f) => { if (String(f.name || '').toLowerCase().includes(query)) hits.push(slimFile(f)); });
        if (list.length < 100) break;
    }
    return { query, recordings: hits.slice(0, pageSize), scanned: 'the 500 newest recordings' };
}

function isPrivateAddress(address) {
    const a = String(address || '').toLowerCase();
    if (net.isIPv4(a)) {
        const [x, y] = a.split('.').map(Number);
        return x === 10 || x === 127 || x === 0 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
            || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224;
    }
    if (net.isIPv6(a)) {
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
        if (mapped) return isPrivateAddress(mapped[1]);
        return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
    }
    return true;
}

/** A transcript / note block's text: inline, or behind its data_link (a signed https file at Plaud's storage). */
async function blockText(block) {
    if (!block) return '';
    if (typeof block.data_content === 'string' && block.data_content) return block.data_content;
    const link = typeof block.data_link === 'string' ? block.data_link : '';
    if (!link) return '';
    let url;
    try { url = new URL(link); } catch (_e) { throw new PlaudError('Plaud gave a broken content link', 'PLAUD_BAD_LINK'); }
    if (url.protocol !== 'https:' || url.username || url.password || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new PlaudError('Plaud gave a content link this server does not follow', 'PLAUD_BAD_LINK');
    const addrs = await deps.lookup(url.hostname).catch(() => []);
    if (!addrs.length || addrs.some((x) => isPrivateAddress(x.address))) throw new PlaudError('Plaud gave a content link this server does not follow', 'PLAUD_BAD_LINK');
    let res;
    try {
        res = await deps.fetch(url.toString(), { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
        throw new PlaudError(`Plaud's storage could not be reached (${e.message})`, 'PLAUD_NETWORK');
    }
    if (res.status !== 200) throw new PlaudError(`Plaud's storage answered ${res.status}`, 'PLAUD_REFUSED');
    if (Number(res.headers.get('content-length')) > MAX_BLOCK_BYTES) throw new PlaudError('That transcript is too large', 'PLAUD_TOO_LARGE');
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BLOCK_BYTES) throw new PlaudError('That transcript is too large', 'PLAUD_TOO_LARGE');
    return text;
}

function clock(ms) {
    const t = Math.max(0, Math.floor(Number(ms) / 1000));
    const h = Math.floor(t / 3600);
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const sec = String(t % 60).padStart(2, '0');
    return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

/** Plaud's segments ([{start_time, end_time, speaker, content}]) as "[mm:ss] Speaker: text" lines. */
function renderSegments(content) {
    let parsed;
    try { parsed = JSON.parse(content); } catch (_e) { return content; }
    if (!Array.isArray(parsed)) return JSON.stringify(parsed, null, 2);
    return parsed.map((seg) => {
        const time = typeof (seg && seg.start_time) === 'number' ? `[${clock(seg.start_time)}] ` : '';
        const speaker = seg && seg.speaker ? `${seg.speaker}: ` : '';
        return `${time}${speaker}${(seg && (seg.content || seg.topic)) || ''}`.trim();
    }).filter(Boolean).join('\n');
}

async function fileOf(id) {
    const fileId = String(id || '').trim();
    if (!fileId || fileId.length > 200) throw new PlaudError('recordingId is required', 'PLAUD_NO_ID');
    const r = await api(`/open/third-party/files/${encodeURIComponent(fileId)}`);
    return r.data && typeof r.data === 'object' && !Array.isArray(r.data) && r.data.id ? r.data : r;
}

async function getRecording(id) {
    const f = await fileOf(id);
    const sources = Array.isArray(f.source_list) ? f.source_list : [];
    const noteBlocks = Array.isArray(f.note_list) ? f.note_list : [];
    const notes = [];
    for (const n of noteBlocks) {
        let text = '';
        try { text = await blockText(n); } catch (e) { text = `(not readable: ${e.message})`; }
        if (text) notes.push({ type: String(n.data_type || ''), title: String(n.data_title || n.title || ''), markdown: text });
    }
    return Object.assign(slimFile(f), {
        source: `plaud:${String(f.id || id)}`,
        transcriptBlocks: sources.map((s) => String(s.data_type || '')).filter((t) => BLOCKS.includes(t)),
        notes
    });
}

async function getTranscript(id, opts) {
    const o = opts || {};
    const block = BLOCKS.includes(o.block) ? o.block : 'transaction';
    const f = await fileOf(id);
    const sources = Array.isArray(f.source_list) ? f.source_list : [];
    const src = sources.find((s) => s.data_type === block);
    const available = sources.map((s) => String(s.data_type || '')).filter(Boolean);
    if (!src) return { id: String(f.id || id), name: String(f.name || ''), block, available, text: '', note: `No "${block}" block on this recording.` };
    const text = renderSegments(await blockText(src));
    const offset = Math.max(0, Math.floor(Number(o.offset) || 0));
    const slice = text.slice(offset, offset + TRANSCRIPT_PAGE);
    const next = offset + slice.length < text.length ? offset + slice.length : null;
    return { id: String(f.id || id), name: String(f.name || ''), block, available, totalChars: text.length, offset, nextOffset: next, text: slice };
}

module.exports = {
    PlaudError,
    STATUS_TYPE,
    bind: (fn) => { broadcast = typeof fn === 'function' ? fn : null; },
    BLOCKS,
    status,
    linkStart,
    linkFinish,
    linkCancel,
    unlink,
    listRecordings,
    getRecording,
    getTranscript,
    _test: {
        setDeps: (d) => { deps = Object.assign(deps, d || {}); },
        reset: () => { state = null; pending = null; refreshing = null; lastError = ''; stopListening(); },
        parsePasted,
        renderSegments,
        isPrivateAddress,
        REDIRECT_URI,
        listening: () => listeners.length
    }
};
