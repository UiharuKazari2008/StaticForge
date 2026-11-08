/**
 * XLink Operator Console (Yozora #719): the server side of the XLink program (apps/xlink), which
 * replaces the old AVS-Menu web app ("XLink Global Management", github.com/UiharuKazari2008/AVS-Menu).
 *
 * The cabinets are plain HTTP boxes on the LAN (power, volume, card reader, fans ...). The browser
 * cannot reach them, so every request goes from here. The client never sends a URL: it names a
 * device, an item path and an operation, and the URL is looked up in menu.json, so the console can
 * only call what the operator's own menu.json lists.
 *
 * Files, in the app's data dir (.cache/packages/.data/xlink/), read again whenever they change:
 *   menu.json    { devices: { <key>: Device } }, AVS-Menu's format unchanged
 *
 * menu.json semantics follow AVS-Menu's server.js:
 *   status + replace   [match, text, colour]: case-insensitive substring of the body, LAST match wins;
 *                      no match shows the raw body. Non-200 / transport error -> FAILURE (red).
 *   pre_status         { url, match, replace }: when its body does not contain match, the item shows
 *                      the pre body (through pre_status.replace) and the real status is not asked.
 *   toggle             the FIRST entry with a match[].str found in the (replaced) status is lit; when
 *                      a status exists but nothing matches, the LAST button is lit ("off").
 *   slider             GET slider + value (0..100).
 *   warning            shown when GET check contains match (case-insensitive), or always: true.
 *                      A failed check does not warn. A parent's warning also guards its children's
 *                      plain buttons (Game Select's discs).
 * Fixed from AVS-Menu: match.color now sets the text colour (it used bg), a toggle inside a submenu
 * asks its own warning before its parent's, and every text is escaped by the client.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.XLINK_DATA_DIR || path.join(__dirname, '..', '.cache', 'packages', '.data', 'xlink');
const STATUS_TIMEOUT_MS = 10000;
const CHECK_TIMEOUT_MS = 3000;
const ACTION_TIMEOUT_MS = 30000;
const SNAPSHOT_TTL_MS = 4000;
const BODY_LIMIT = 4096;

const files = new Map(); // name -> { mtimeMs, data }

function readJson(name, fallback) {
    const file = path.join(DATA_DIR, name);
    let st;
    try { st = fs.statSync(file); } catch (_) { files.delete(name); return fallback; }
    const hit = files.get(name);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.data;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    files.set(name, { mtimeMs: st.mtimeMs, data });
    return data;
}

function menu() {
    const m = readJson('menu.json', null);
    if (!m || typeof m !== 'object' || !m.devices || typeof m.devices !== 'object') {
        const err = new Error('menu.json is missing or has no devices');
        err.code = 'XLINK_NO_MENU';
        throw err;
    }
    return m;
}

function isHttpUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u);
}

/** GET a cabinet URL. Never throws: { ok, code, body, ms, error } */
async function get(url, timeoutMs) {
    const t0 = Date.now();
    if (!isHttpUrl(url)) return { ok: false, code: 0, body: '', ms: 0, error: 'Not an http(s) URL' };
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow', headers: { 'User-Agent': 'XLink-OperatorConsole/3.02' } });
        const text = (await res.text()).slice(0, BODY_LIMIT);
        return { ok: res.status === 200, code: res.status, body: text, ms: Date.now() - t0 };
    } catch (err) {
        const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
        const cause = err && err.cause && (err.cause.code || err.cause.message);
        return { ok: false, code: 0, body: '', ms: Date.now() - t0, error: timedOut ? 'Timed out' : (cause || (err && err.message) || 'Request failed') };
    }
}

/** [text, colour] from a body through a replace table (last match wins). */
function applyReplace(body, replace) {
    const text = String(body == null ? '' : body);
    if (Array.isArray(replace)) {
        const low = text.toLowerCase();
        const hits = replace.filter((r) => Array.isArray(r) && r[0] != null && low.includes(String(r[0]).toLowerCase()));
        if (hits.length) {
            const r = hits[hits.length - 1];
            return [String(r[1] == null ? '' : r[1]), String(r[2] == null ? '' : r[2])];
        }
    }
    return [text.trim(), ''];
}

/** An item's (or device's) status: null when it has none, else { text, color, failed }. */
async function statusOf(node, log) {
    if (!node || !node.status) return null;
    const pre = node.pre_status;
    if (pre && pre.url) {
        const r = await get(pre.url, STATUS_TIMEOUT_MS);
        if (log) log(r, pre.url, 'POLL');
        if (!r.ok) return { text: 'FAILURE', color: 'red', failed: true };
        if (!String(r.body).includes(String(pre.match == null ? '' : pre.match))) {
            const [text, color] = applyReplace(r.body, pre.replace);
            return { text, color, gated: true };
        }
    }
    const r = await get(node.status, STATUS_TIMEOUT_MS);
    if (log) log(r, node.status, 'POLL');
    if (!r.ok) return { text: 'FAILURE', color: 'red', failed: true };
    const [text, color] = applyReplace(r.body, node.replace);
    return { text, color };
}

function matchesStr(status, m) {
    return m && m.str != null && String(status).toLowerCase().includes(String(m.str).toLowerCase());
}

/**
 * The toggle row: [{ label, icon, bg, color, active }]. Lit button as in AVS-Menu (first match,
 * else the last button when a status exists and some entry has a match list).
 */
function toggleRow(node, status) {
    const t = Array.isArray(node.toggle) ? node.toggle.map((e) => (typeof e === 'string' ? { url: e } : (e || {}))) : [];
    let lit = -1;
    let litMatch = null;
    const anyMatch = t.some((e) => Array.isArray(e.match));
    if (status && !status.failed && anyMatch) {
        lit = t.findIndex((e) => Array.isArray(e.match) && e.match.some((m) => matchesStr(status.text, m)));
        if (lit >= 0) litMatch = t[lit].match.find((m) => matchesStr(status.text, m));
        else lit = t.length - 1;
    }
    return t.map((e, i) => {
        const active = i === lit;
        const m = active ? litMatch : null;
        const icon = (m && m.icon) || (!m || !m.text ? e.icon : '') || '';
        const label = (m && m.text) || e.text || (t.length <= 2 ? (i === 0 ? 'I' : 'O') : String(i));
        return {
            label,
            icon: icon || '',
            bg: active ? ((m && m.bg) || e.bg || '') : '',
            color: active ? ((m && m.color) || e.color || '') : '',
            active
        };
    });
}

function badgesOf(node) {
    return Array.isArray(node.badges) ? node.badges.map((b) => ({ text: String(b.text || ''), color: b.color || '', textColor: b.text_color || '' })) : [];
}

/** A menu item for the client (no URLs other than for display in Properties). */
async function describeItem(node, log) {
    const status = await statusOf(node, log);
    const children = Array.isArray(node.children) ? await Promise.all(node.children.map((c) => describeItem(c, log))) : [];
    return {
        text: String(node.text || ''),
        icon: String(node.icon || ''),
        badges: badgesOf(node),
        append: String(node.append || ''),
        status,
        kind: Array.isArray(node.toggle) && node.toggle.length ? 'toggle' : (node.slider ? 'slider' : (node.url ? 'button' : (children.length ? 'folder' : 'info'))),
        toggle: Array.isArray(node.toggle) && node.toggle.length ? toggleRow(node, status) : null,
        warning: !!(node.warning && (node.warning.always || (node.warning.check && node.warning.match))),
        endpoints: {
            status: node.status || '',
            action: node.url || '',
            slider: node.slider || '',
            toggle: Array.isArray(node.toggle) ? node.toggle.map((e) => (typeof e === 'string' ? e : (e && e.url) || '')) : []
        },
        children
    };
}

function sortedDevices(m) {
    return Object.keys(m.devices)
        .map((key) => ({ key, d: m.devices[key] || {} }))
        .sort((a, b) => (Number(a.d.position) || 0) - (Number(b.d.position) || 0));
}

/** The device list with each device's own status (no item polling). */
async function devices(log) {
    const m = menu();
    return Promise.all(sortedDevices(m).map(async ({ key, d }) => ({
        key,
        name: String(d.name || key),
        icon: String(d.icon || ''),
        badges: badgesOf(d),
        status: await statusOf(d, log),
        items: Array.isArray(d.items) ? d.items.length : 0
    })));
}

const snapshots = new Map(); // device key -> { at, data, pending }

/** One device polled in full (its status, every item and child), cached SNAPSHOT_TTL_MS. */
async function device(key, opts) {
    const o = opts || {};
    const m = menu();
    const d = m.devices[key];
    if (!d || !Array.isArray(d.items)) {
        const err = new Error('Invalid Device ID');
        err.code = 'XLINK_NO_DEVICE';
        throw err;
    }
    const hit = snapshots.get(key);
    if (!o.force && hit && hit.data && Date.now() - hit.at < SNAPSHOT_TTL_MS) return { ...hit.data, cached: true };
    if (hit && hit.pending) return hit.pending;
    const log = [];
    const pending = (async () => {
        const push = (r, url, verb) => log.push(logLine(verb, url, r));
        const [status, items] = await Promise.all([statusOf(d, push), Promise.all(d.items.map((it) => describeItem(it, push)))]);
        const data = { key, name: String(d.name || key), icon: String(d.icon || ''), badges: badgesOf(d), status, items, polledAt: Date.now(), log };
        snapshots.set(key, { at: Date.now(), data });
        return data;
    })();
    snapshots.set(key, { ...(hit || {}), pending });
    try {
        return await pending;
    } catch (err) {
        snapshots.delete(key);
        throw err;
    }
}

function logLine(verb, url, r) {
    let host = url;
    try { const u = new URL(url); host = `${u.host}${u.pathname}${u.search}`; } catch (_) { /* keep */ }
    return { t: Date.now(), verb, url: host, code: r.code, ms: r.ms, ok: r.ok, error: r.error || '', body: r.ok ? '' : String(r.body || '').slice(0, 200) };
}

/** items[path[0]].children[path[1]] ... -> { node, parent } */
function resolve(key, itemPath) {
    const m = menu();
    const d = m.devices[key];
    if (!d || !Array.isArray(d.items)) throw Object.assign(new Error('Invalid Device ID'), { code: 'XLINK_NO_DEVICE' });
    const p = Array.isArray(itemPath) ? itemPath.map((n) => Number(n)) : [];
    if (!p.length || p.some((n) => !Number.isInteger(n) || n < 0)) throw Object.assign(new Error('Invalid item'), { code: 'XLINK_NO_ITEM' });
    let list = d.items;
    let node = null;
    let parent = null;
    for (const i of p) {
        if (!Array.isArray(list) || !list[i]) throw Object.assign(new Error('Invalid item'), { code: 'XLINK_NO_ITEM' });
        parent = node;
        node = list[i];
        list = node.children;
    }
    return { device: d, node, parent };
}

async function warningApplies(w, log) {
    if (!w) return false;
    if (w.check && w.match) {
        const r = await get(w.check, CHECK_TIMEOUT_MS);
        if (log) log.push(logLine('CHECK', w.check, r));
        return r.ok && String(r.body).toLowerCase().includes(String(w.match).toLowerCase());
    }
    return !!w.always;
}

/**
 * Run an operation: { device, path, op: 'send' | 'toggle' | 'slider', value, confirmed }.
 * Returns { confirm: warning } when a warning applies and confirmed is not set, else
 * { ok, code, failure, log, snapshot } (never an `error` key: that marks a failed request).
 */
async function action(req) {
    const r = req || {};
    const { node, parent } = resolve(r.device, r.path);
    const op = String(r.op || 'send');
    let url = '';
    let warning = null;
    if (op === 'toggle') {
        const t = Array.isArray(node.toggle) ? node.toggle : [];
        const e = t[Number(r.value)];
        url = typeof e === 'string' ? e : (e && e.url) || '';
        warning = node.warning || (parent && parent.warning) || null;
    } else if (op === 'slider') {
        const v = Math.round(Number(r.value));
        if (!node.slider || !Number.isFinite(v) || v < 0 || v > 100) throw Object.assign(new Error('Invalid slider value'), { code: 'XLINK_BAD_VALUE' });
        url = `${node.slider}${v}`;
    } else {
        url = node.url || '';
        warning = node.warning || (parent && parent.warning) || null;
    }
    if (!url) throw Object.assign(new Error('This function has no action'), { code: 'XLINK_NO_ACTION' });
    const log = [];
    if (warning && !r.confirmed && await warningApplies(warning, log)) {
        return {
            confirm: {
                header: String(warning.header || 'Warning'),
                message: String(warning.message || ''),
                ok: String(warning.ok || 'OK'),
                icon: String(warning.icon || 'exclamation-triangle'),
                iconColor: String(warning.icon_color || '')
            },
            log
        };
    }
    const res = await get(url, ACTION_TIMEOUT_MS);
    log.push(logLine(op === 'slider' ? 'SET' : 'SEND', url, res));
    snapshots.delete(r.device);
    let snapshot = null;
    try { snapshot = await device(r.device, { force: true }); } catch (_) { /* the action result still stands */ }
    return {
        ok: res.ok,
        code: res.code,
        failure: res.ok ? '' : (res.error || (res.body ? String(res.body).slice(0, 400) : 'Failed to get a valid response from the MCU unit')),
        log,
        snapshot
    };
}

/** Save menu.json from the console's Import (validated JSON). */
function saveFile(name, text) {
    if (name !== 'menu.json') throw Object.assign(new Error('Unknown file'), { code: 'XLINK_BAD_FILE' });
    const data = JSON.parse(String(text));
    if ((!data || typeof data.devices !== 'object' || !data.devices)) throw Object.assign(new Error('menu.json needs a "devices" object'), { code: 'XLINK_BAD_FILE' });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = path.join(DATA_DIR, `.${name}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmp, path.join(DATA_DIR, name));
    files.delete(name);
    snapshots.clear();
    return { saved: name };
}

function info() {
    let count = 0;
    let problem = '';
    try { count = Object.keys(menu().devices).length; } catch (err) { problem = err.message; }
    return { dataDir: DATA_DIR, devices: count, problem };
}

module.exports = { DATA_DIR, devices, device, action, saveFile, info, _applyReplace: applyReplace, _toggleRow: toggleRow, _get: get };
