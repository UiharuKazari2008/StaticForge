'use strict';

/**
 * Test devices: phones that are partnered with the live server for testing (the Android emulator on Ruiko,
 * ~/.config/aemu) and fenced off from the household's notices (Yukimi, Nov 18 2026: "heavy fuss testing and
 * notification tests ... in every state", on the live server, never reaching her Fold).
 *
 * A test device works like any partnered phone (its background link, its page, Miniport), but its notices run in a
 * lane of their own, the inbox user 'test':
 *   - the household's notices (users admin / dev_admin) are never sent to it: not live, not on its hello catch-up,
 *     not in its status.snapshot;
 *   - the test lane's notices (published only through /api/test-devices, modules/testDevicesRoute.js) go to test
 *     devices alone and never reach a page or a phone outside the lane;
 *   - whatever its app or page acks, snoozes, clears or sets for notices (inbox_ack, inbox_prefs, phone_status_prefs,
 *     reminder_*, msg_new_seen) lands in the test lane, so a dismissed or auto-hidden box on the emulator can never
 *     clear or quiet a notice on a real phone;
 *   - its own news (notify.posted / notify.removed from its Android notifications) is not taken into the household's
 *     Messaging accounts or Melaton Videos, and is not relayed to computers.
 *
 * Its sockets are known by the ActiveSync device id on them (info.as.id, set by its hello) and, before a page has said
 * hello, by the session its background link used (the app's link and its WebView share one session cookie).
 *
 * Kept in <databases>/test-devices.json: { devices: { <id>: { name, markedAt, status } }, sessions: { <sid>: <id> } }.
 * status: snapshot fields a test sets for its devices (mail unread, weather alerts, ...) over the real ones.
 */

const fs = require('fs');
const path = require('path');

let file = null;
let state = null;

function storePath() {
    if (file) return file;
    // the databases folder of the running server; never require globalResources here (requiring it boots the
    // server's resources: a test or script would start a second copy beside the live one)
    let dir = null;
    try {
        const loaded = require.cache[require.resolve('./globalResources')];
        if (loaded && loaded.exports && typeof loaded.exports.getPath === 'function') dir = loaded.exports.getPath('databases');
    } catch (_e) { /* not loaded: the default below */ }
    file = process.env.TEST_DEVICES_FILE || path.join(dir || path.join(__dirname, '..', '.cache'), 'test-devices.json');
    return file;
}

function load() {
    if (state) return state;
    state = { devices: {}, sessions: {} };
    try {
        const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
        if (raw && typeof raw === 'object') {
            if (raw.devices && typeof raw.devices === 'object') state.devices = raw.devices;
            if (raw.sessions && typeof raw.sessions === 'object') state.sessions = raw.sessions;
        }
    } catch (_e) { /* none yet */ }
    return state;
}

function save() {
    try {
        const p = storePath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = `${p}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(load(), null, 1));
        fs.renameSync(tmp, p);
    } catch (e) {
        console.warn(`[test-devices] not saved: ${e.message}`);
    }
}

const ID_RE = /^[0-9a-f]{32}$/;
const normId = (id) => String(id || '').trim().toLowerCase();

function isTestDevice(id) {
    const d = normId(id);
    return !!d && Object.prototype.hasOwnProperty.call(load().devices, d);
}

/** A socket's clientInfo: is it a test device's (its background link, its page, a Miniport port of it)? */
function isTestInfo(info) {
    if (!info) return false;
    if (info.as && info.as.kind === 'device' && isTestDevice(info.as.id)) return true;
    const sid = info.sessionId;
    if (!sid) return false;
    const owner = load().sessions[String(sid)];
    return !!owner && isTestDevice(owner);
}

/** A test device said hello: remember the session it used, so its page is fenced before its own hello. */
function noteHello(d) {
    if (!d || !isTestDevice(d.id) || !d.sessionId) return;
    const s = load().sessions;
    if (s[String(d.sessionId)] === normId(d.id)) return;
    s[String(d.sessionId)] = normId(d.id);
    // a handful per device (an app reinstall signs in again): keep the newest few
    const mine = Object.keys(s).filter((k) => s[k] === normId(d.id));
    while (mine.length > 8) delete s[mine.shift()];
    save();
}

function mark(id, { name } = {}) {
    const d = normId(id);
    if (!ID_RE.test(d)) return null;
    const devs = load().devices;
    devs[d] = Object.assign({ status: {} }, devs[d] || {}, { name: String(name || (devs[d] && devs[d].name) || 'Test device').slice(0, 80), markedAt: (devs[d] && devs[d].markedAt) || Date.now() });
    save();
    return Object.assign({ id: d }, devs[d]);
}

function unmark(id) {
    const d = normId(id);
    const st = load();
    if (!st.devices[d]) return false;
    delete st.devices[d];
    for (const k of Object.keys(st.sessions)) if (st.sessions[k] === d) delete st.sessions[k];
    save();
    return true;
}

/** The snapshot fields a test set for test devices (merged over the real ones by phoneStatus). */
function statusOverrides(id) {
    const dev = load().devices[normId(id)];
    return (dev && dev.status && typeof dev.status === 'object') ? dev.status : {};
}

function setStatusOverrides(id, status, { replace = false } = {}) {
    const dev = load().devices[normId(id)];
    if (!dev) return null;
    const src = status && typeof status === 'object' && !Array.isArray(status) ? status : {};
    dev.status = replace ? {} : Object.assign({}, dev.status || {});
    for (const [k, v] of Object.entries(src)) {
        if (!/^[a-z]{2,20}$/.test(k)) continue;
        if (v === null) delete dev.status[k];
        else dev.status[k] = v;
    }
    save();
    return dev.status;
}

function list() {
    return Object.entries(load().devices).map(([id, d]) => Object.assign({ id }, d));
}

module.exports = {
    isTestDevice,
    isTestInfo,
    noteHello,
    mark,
    unmark,
    list,
    statusOverrides,
    setStatusOverrides,
    _test: { reset: () => { state = null; file = null; } }
};
