'use strict';

/**
 * Test devices: the ones connected to the live server for testing (the Android emulator on Ruiko, scripts/aemu-lane,
 * DreamOS test VMs) and fenced off from the household's notices (Yukimi, Nov 18 2026: "heavy fuss testing and
 * notification tests ... in every state", on the live server, never reaching her Fold) and from her ActiveSync store
 * (#1334: "stop adding them to the store when they're not going to be kept"). The Fold and the A53 are the household's
 * own devices (#1334): nothing here recognises either.
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
 * Two kinds of mark. Most marked devices are the lane's (inLane()). The agents' A53 test phone is a household device
 * that agents run notice tests on: its mark is FENCE-ONLY ({ fenceOnly: true }, isFenceOnly()). That fences its notices
 * as above and changes nothing else: its record stays in .cache/activesync.db, it is listed like any phone, it is never
 * moved or dropped by itself, and removing the mark removes only the fence. So: isTestDevice() / isTestInfo() ask "are
 * its notices the test lane's" (both kinds), inLane() / isLaneInfo() ask "is it out of the household's store and lists"
 * (the lane's only).
 *
 * A device is the lane's because it was marked (mark()), or because its hello says what it is (classify():
 * modules/activeSync.js marks it before anything of it is written). Which mark an id may have is asked of
 * modules/activeSync.js (setMarkGuard()): fence-only for the test phone, none for any other of the household's own.
 * A lane device's ActiveSync record (partnership, permissions, name, last status) is kept HERE, never in
 * .cache/activesync.db. An entry that has been gone for a day is dropped by itself when it would be recognised again
 * (sweep(), asked at ActiveSync hellos; no timer).
 *
 * Its sockets are known by the ActiveSync device id on them (info.as.id, set by its hello) and, before a page has said
 * hello, by the session its background link used (the app's link and its WebView share one session cookie).
 *
 * Kept in <databases>/test-devices.json:
 *   { devices: { <id>: { name, markedAt, status, kind?, record?, fenceOnly? } }, sessions: { <sid>: <id> } }
 * status: snapshot fields a test sets for its devices (mail unread, weather alerts, ...) over the real ones.
 * record: the device's ActiveSync record, with the column names of an as_devices row (ROW_FIELDS). Its partner is
 * 1 (set up), 0 (ended: it stays so) or null (nobody decided yet: an administrator's next hello sets it up).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_NAME = 'Test device';
const KINDS = new Set(['emulator', 'test-vm']);
const ROW_FIELDS = ['device_id', 'name', 'model', 'os', 'app', 'partner', 'permissions', 'sync_items', 'settings', 'last_status', 'first_seen', 'last_seen', 'last_sync', 'platform'];
// these move by themselves: alone they are not worth a write at once (rule phone-power-server)
const CLOCK_FIELDS = new Set(['last_status', 'first_seen', 'last_seen', 'last_sync']);
const CLOCK_SAVE_MS = 10 * 60 * 1000;
const GONE_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
// after a restart the devices need a while to come back
const SWEEP_AFTER_START_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 60;
const STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

let file = null;
let fallbackFile = null;
let state = null;
let unsaved = false;
let savedAt = 0;
let sweptAt = 0;
let clock = () => Date.now();
let markGuard = null;
const markedHooks = [];
const droppedHooks = [];

function storePath() {
    if (file) return file;
    if (!process.env.TEST_DEVICES_FILE && fallbackFile) return fallbackFile;
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

/** A test's registry when it names none (activeSync.resetForTests): never the server's file. */
function useDefaultFile(p) {
    if (process.env.TEST_DEVICES_FILE) return;
    fallbackFile = p;
    file = null;
    state = null;
    unsaved = false;
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
        unsaved = false;
        savedAt = clock();
        return true;
    } catch (e) {
        unsaved = true;
        console.warn(`[test-devices] not saved: ${e.message}`);
        return false;
    }
}

/** Everything held is on disk (a caller about to delete its own copy asks). */
function flush() {
    return unsaved ? save() : true;
}

// 32 hex from the app; ActiveSync takes 16 to 32, and a test device of any of them stays out of the store
const ID_RE = /^[0-9a-f]{16,32}$/;
const normId = (id) => String(id || '').trim().toLowerCase();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const entryOf = (id) => {
    const devs = load().devices;
    const d = normId(id);
    return d && has(devs, d) ? devs[d] : null;
};

/**
 * An emulator by what it says it is, whether or not it was ever marked as a test device: an emulator-NNNN serial,
 * an AVD / aemu model (the shapes modules/deviceConsent.js reads too). Never a physical phone, so never hers.
 * Yukimi, Nov 26 2026, #1299: "how do we delete the massive list of dead devices and fake devices in mobile device
 * center" - this is what "fake" means: the emulator lane's leftover rows.
 */
const EMULATOR_SHAPE = /sdk_gphone|google_sdk|generic_x86|generic_x64|ranchu|goldfish|aemu|\bavd\b|\bemulator\b/i;
function isEmulatorShape(id, model, name) {
    if (/^emulator-\d+$/i.test(String(id || ''))) return true;
    return EMULATOR_SHAPE.test(`${model || ''} ${name || ''}`);
}

// what a virtual machine's maker or product name says (DreamOS test VMs); her DreamOS computers are real ones
const VM_SHAPE = /vmware|virtualbox|innotek|qemu|standard pc|\bkvm\b|bochs|virtual machine/i;

/**
 * Is a device a test device by what it is? 'emulator' | 'test-vm' | null. From the model, the platform and a DreamOS
 * machine's maker only: never the name, which its owner chooses.
 */
function classify({ id, model, platform, vendor } = {}) {
    const m = String(model || '').trim();
    if (isEmulatorShape(id, m, '')) return 'emulator';
    if (platform === 'cafeready' && (VM_SHAPE.test(m) || VM_SHAPE.test(String(vendor || '')))) return 'test-vm';
    return null;
}

/** A DreamOS machine's maker, from a record's last_status (its JSON text). */
function vendorOf(lastStatus) {
    if (!lastStatus) return '';
    try {
        const s = typeof lastStatus === 'string' ? JSON.parse(lastStatus) : lastStatus;
        return (s && s.host && s.host.vendor) || '';
    } catch (_e) { return ''; }
}

/** classify() of an as_devices row or a registry record. */
function classifyRow(row) {
    if (!row) return null;
    return classify({ id: row.device_id, model: row.model, platform: row.platform, vendor: vendorOf(row.last_status) });
}

/** Are this device's notices the test lane's? Any marked one, the fence-only test phone too. */
function isTestDevice(id) {
    return !!entryOf(id);
}

/** Marked for the notice fence only (the agents' test phone): the household's in every other way. */
function isFenceOnly(id) {
    const e = entryOf(id);
    return !!e && e.fenceOnly === true;
}

/** A device of the test lane: its record is here, never in activesync.db, and it is out of the household's lists and news. */
function inLane(id) {
    const e = entryOf(id);
    return !!e && e.fenceOnly !== true;
}

/** A test device's kind: as marked, else what its record shows, else 'marked' (by hand); null for any other device. */
function kindOf(id) {
    const e = entryOf(id);
    if (!e) return null;
    return e.kind || classifyRow(e.record) || 'marked';
}

/** The device ids a socket may be: the one its hello named, and the one its session was last used by. */
function idsOf(info) {
    if (!info) return [];
    const ids = [];
    if (info.as && info.as.kind === 'device') ids.push(info.as.id);
    const owner = info.sessionId ? load().sessions[String(info.sessionId)] : null;
    if (owner) ids.push(owner);
    return ids;
}

/** A socket's clientInfo: are its notices the test lane's (a marked device's background link, page, Miniport port)? */
function isTestInfo(info) {
    return idsOf(info).some(isTestDevice);
}

/** The same asked for lists and records: is the socket a lane device's (never the fence-only test phone's)? */
function isLaneInfo(info) {
    return idsOf(info).some(inLane);
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

/** An entry as callers see it: without its record (row() gives that). */
function view(id) {
    const { record: _record, ...rest } = load().devices[id];
    return Object.assign({ id }, rest, { kind: kindOf(id) });
}

function run(hooks, ...args) {
    for (const fn of hooks) {
        try { fn(...args); } catch (e) { console.warn(`[test-devices] ${e.message}`); }
    }
}

/** fn(id) after every mark() (modules/activeSync.js moves a row it still has). */
function onMarked(fn) { if (typeof fn === 'function') markedHooks.push(fn); }
/** fn(id, entry) after an entry went (gone for a day, over the cap, unmarked): what is kept beside a lane device's goes too. */
function onDropped(fn) { if (typeof fn === 'function') droppedHooks.push(fn); }

/**
 * fn(id) -> which mark an id may have (modules/activeSync.js registers it): 'fence' (the agents' test phone: the notice
 * fence only), 'refuse' (any other of the household's own devices) or '' (the lane's to mark).
 */
function setMarkGuard(fn) { markGuard = typeof fn === 'function' ? fn : null; }

/** The guard's word on an id. A question that cannot be answered, and any word but those two, is a refusal. */
function guardWord(d) {
    try {
        // the guard is ActiveSync's: the test lane's route may be the first to touch it after a start
        if (!markGuard) require('./activeSync');
        const word = markGuard ? markGuard(d) : '';
        if (!word) return '';
        if (word === 'fence') return 'fence';
        console.warn(`[test-devices] ${d.slice(0, 8)} not marked: it is one of the household's devices`);
    } catch (e) {
        console.warn(`[test-devices] ${d.slice(0, 8)} not marked: the household's devices could not be asked (${e.message})`);
    }
    return 'refuse';
}

/**
 * Make a device a test device (or rename one). The agents' test phone gets a fence-only mark, which stays one until it
 * is removed. null, and nothing changed: a bad id, or one of the household's other devices.
 */
function mark(id, { name, kind } = {}) {
    const d = normId(id);
    if (!ID_RE.test(d)) return null;
    const word = guardWord(d);
    if (word === 'refuse') return null;
    const devs = load().devices;
    const old = has(devs, d) ? devs[d] : null;
    const before = old ? JSON.stringify(old) : '';
    const e = old || { status: {} };
    if (!e.status) e.status = {};
    e.name = String(name || e.name || DEFAULT_NAME).slice(0, 80);
    e.markedAt = e.markedAt || clock();
    if (word === 'fence') e.fenceOnly = true;
    if (e.fenceOnly) { delete e.record; delete e.kind; } // a fence holds no record, ever
    else if (KINDS.has(kind)) e.kind = kind;
    if (e.record) e.record.name = e.name;
    devs[d] = e;
    if (JSON.stringify(e) !== before) save();
    run(markedHooks, d);
    return has(load().devices, d) ? view(d) : null;
}

/** Turn a mark into a fence-only one (it turned out to be the agents' test phone's). Its record, if any, goes. */
function fence(id) {
    const e = entryOf(id);
    if (!e || e.fenceOnly) return false;
    e.fenceOnly = true;
    delete e.record;
    delete e.kind;
    save();
    run(markedHooks, normId(id));
    return true;
}

function drop(d) {
    const st = load();
    if (!has(st.devices, d)) return false;
    const gone = st.devices[d];
    delete st.devices[d];
    for (const k of Object.keys(st.sessions)) if (st.sessions[k] === d) delete st.sessions[k];
    save();
    run(droppedHooks, d, gone);
    return true;
}

function unmark(id) {
    return drop(normId(id));
}

// ---------------------------------------------------------------- the ActiveSync record (never in activesync.db)

const blankRecord = (id) => ({
    device_id: id, name: '', model: '', os: '', app: '', partner: null, permissions: '[]', sync_items: '[]', settings: '{}',
    last_status: null, first_seen: clock(), last_seen: clock(), last_sync: null, platform: ''
});

/** A copy of a test device's record, or null while it has never said hello (or been moved from the store). */
function row(id) {
    const e = entryOf(id);
    if (!e || !e.record || e.fenceOnly) return null;
    const d = normId(id);
    return Object.assign(blankRecord(d), e.record, { device_id: d, name: e.name });
}

function rows() {
    return Object.keys(load().devices).map(row).filter(Boolean);
}

/**
 * Set fields of a test device's record (create: make it when there is none). The name is the entry's: a first record
 * takes the one given only while the entry has none of its own, a later one (a partnership's) replaces it. Written to
 * disk at once when more than clocks and status changed; clocks and status with persist 'now' (a hello, a closing
 * socket), else at most every 10 minutes. false: not a device of the lane, or no record to change.
 */
function setRow(id, fields, { create = false, persist = '' } = {}) {
    const e = entryOf(id);
    if (!e || e.fenceOnly) return false;
    const fresh = !e.record;
    if (fresh && !create) return false;
    const d = normId(id);
    if (fresh) e.record = blankRecord(d);
    let changed = fresh;
    let real = fresh;
    for (const k of ROW_FIELDS) {
        if (k === 'device_id' || !has(fields, k)) continue;
        const v = fields[k] === undefined ? null : fields[k];
        if (k === 'name') {
            if (!v || (fresh && e.name && e.name !== DEFAULT_NAME)) continue;
            const name = String(v).slice(0, 80);
            if (e.name !== name) { e.name = name; changed = true; real = true; }
            continue;
        }
        if (e.record[k] === v) continue;
        e.record[k] = v;
        changed = true;
        if (!CLOCK_FIELDS.has(k)) real = true;
    }
    e.record.name = e.name;
    if (changed) unsaved = true;
    if (real || (unsaved && (persist === 'now' || clock() - savedAt >= CLOCK_SAVE_MS))) save();
    return true;
}

/** The record goes, the mark stays (a hand-marked device that is forgotten). */
function clearRow(id) {
    const e = entryOf(id);
    if (!e || !e.record) return false;
    delete e.record;
    save();
    return true;
}

// ---------------------------------------------------------------- clean-up

const seenOf = (e) => Math.max(Number(e.record && e.record.last_seen) || 0, Number(e.markedAt) || 0);

/**
 * Offline, and its record would make it a test device again (else its next hello would put it in the store). Never a
 * fence: that goes only when it is removed.
 */
function droppable(isOnline) {
    return Object.entries(load().devices).filter(([id, e]) => !e.fenceOnly && classifyRow(e.record) && !isOnline(id));
}

/**
 * Drop what is gone: offline (isOnline(id) says) and not seen for a day. Asked at ActiveSync hellos; looks at most
 * every 10 minutes and not in the first 10 after a start. Returns the ids dropped.
 */
function sweep(isOnline) {
    const now = clock();
    if (typeof isOnline !== 'function' || now - STARTED_AT < SWEEP_AFTER_START_MS || now - sweptAt < SWEEP_EVERY_MS) return [];
    sweptAt = now;
    const gone = droppable(isOnline).filter(([, e]) => now - seenOf(e) > GONE_MS).map(([id]) => id);
    return gone.filter(drop);
}

/** At most MAX_ENTRIES: the longest unseen of the droppable ones go first. */
function cap(isOnline) {
    const over = Object.keys(load().devices).length - MAX_ENTRIES;
    if (over <= 0 || typeof isOnline !== 'function') return [];
    const oldest = droppable(isOnline).sort((a, b) => seenOf(a[1]) - seenOf(b[1])).slice(0, over).map(([id]) => id);
    return oldest.filter(drop);
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
    return Object.keys(load().devices).map(view);
}

module.exports = {
    isTestDevice,
    isFenceOnly,
    inLane,
    isLaneInfo,
    fence,
    isEmulatorShape,
    classify,
    classifyRow,
    kindOf,
    isTestInfo,
    noteHello,
    mark,
    unmark,
    onMarked,
    onDropped,
    setMarkGuard,
    row,
    rows,
    setRow,
    clearRow,
    flush,
    sweep,
    cap,
    list,
    statusOverrides,
    setStatusOverrides,
    useDefaultFile,
    MAX_ENTRIES,
    _test: {
        reset: () => { state = null; file = null; unsaved = false; savedAt = 0; sweptAt = 0; clock = () => Date.now(); },
        // tests move the clock instead of waiting a day
        setClock: (fn) => { clock = typeof fn === 'function' ? fn : () => Date.now(); },
        startedAt: STARTED_AT
    }
};
