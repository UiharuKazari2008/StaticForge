'use strict';

/**
 * Device queue (Fleet / agent-coord; Yukimi, Nov 26 2026: "just like the restart waits we need a queue for
 * control of testing on shared devices"). Many agents test at once on the same hardware (the A53, the Fold,
 * Ruiko's headful Chrome, the shared headless browser, ...) and trample each other, so a device is used by
 * one agent at a time: request it BEFORE a test, wait for the grant (a steer message arrives), release it
 * when the test ends.
 *
 * Per device: one holder (a lease with an end time) and a FIFO queue. Rows live in the agent-coord DB
 * (table device_queue, created by store.js). There is no timer: a lease that ran out, whose agent's session
 * is gone, or whose agent has been idle for 10 minutes is released the next time the queue is touched
 * (any call here, and the Fleet window's existing 30 s feed), and the next in line is granted.
 *
 * Devices are free-form ids (lower case); KNOWN lists the usual ones with aliases.
 *
 * Phones need consent (#1284): a grant of a device that needsConsent() is a lease in state 'held' with
 * consent 'pending'. Nothing may touch the phone and the lease clock does not run until Yukimi taps Allow on
 * the phone (setConsent 'allowed' sets started_at / ends_at); Deny ends the lease and hands on. The change
 * hook (setChangeHook) tells the Dreamscape server about every state change so it can show the notices
 * (modules/deviceConsent.js); the MCP process reaches the server over supervisor.sock.
 */

const store = require('./store');

const DEFAULT_MIN = 15;
const MAX_MIN = 60;
const IDLE_MS = 10 * 60 * 1000;
/** After Yukimi denies an agent's ask for a phone, that agent may not ask for it again for this long (#1305 S12). */
const DENY_HOLD_MS = 10 * 60 * 1000;

const KNOWN = {
    a53: { name: 'A53 phone', aliases: ['a53', 'samsung-a53', 'galaxy-a53', 'a53-phone', 'phone'] },
    fold: { name: 'Fold', aliases: ['fold', 'z-fold', 'zfold', 'galaxy-fold', 'fold-phone'] },
    'ruiko-chrome': { name: 'Ruiko headful Chrome (CDP 9335)', aliases: ['ruiko-chrome', 'ruiko', 'chrome-9335', 'cdp-9335', '9335', 'headful-chrome', 'gpu-chrome'] },
    'headless-chrome': { name: 'Shared headless browser (:9333)', aliases: ['headless-chrome', 'headless', 'chrome-9333', 'cdp-9333', '9333', 'shared-browser', 'test-browser'] }
};
const ALIAS = new Map();
Object.keys(KNOWN).forEach((id) => KNOWN[id].aliases.forEach((a) => ALIAS.set(a, id)));

/**
 * The emulator pool (the test lane): the ONE list of instance ids. Keep it in step with the pool table in
 * scripts/aemu-lane/lane.sh (pool_row / POOL_IDS); it is not read from that file because the server must not parse a
 * shell script at load (and lane.sh is edited by other sessions), so a new instance is added in both places by hand.
 */
const EMULATOR_IDS = [
    // Fat Misaka (the rack's DL580, second backend, Nov 28 2026) FIRST: a shape request grants these before Ruiko's, which is
    // Yukimi's desktop PC and only the fallback. The ORDER here is the grant order of every shape.
    'aemu-a53-m1', 'aemu-a53-m2', 'aemu-fold-m1', 'aemu-fold-m2',
    'aemu-a53-1', 'aemu-a53-2', 'aemu-a53-3', 'aemu-a53-4', 'aemu-fold-1', 'aemu-fold-2', 'aemu-fold-3', 'aemu-fold-4'
];
/** The rack host an instance runs on ('misaka' for the -m ids), or '' for Ruiko's. A grant on it does not power the host on (lane.sh up does). */
function hostOf(dev) { return /^aemu-(a53|fold)-m\d+$/.test(String(dev || '')) ? 'misaka' : ''; }
/** Shape aliases of coord_device_request: ask for "a free instance of this shape" instead of a named instance. */
const SHAPES = {
    'aemu-a53': { name: 'any A53 emulator', ids: EMULATOR_IDS.filter((i) => i.startsWith('aemu-a53-')) },
    'aemu-fold': { name: 'any Fold emulator', ids: EMULATOR_IDS.filter((i) => i.startsWith('aemu-fold-')) },
    emulator: { name: 'any emulator', ids: EMULATOR_IDS.slice() }
};
const SHAPE_ALIAS = new Map([['aemu-a53', 'aemu-a53'], ['aemu-fold', 'aemu-fold'], ['emulator', 'emulator'], ['emulators', 'emulator'], ['aemu', 'emulator']]);
/** The shape key a device argument names ('aemu-a53', 'aemu-fold', 'emulator'), or ''. */
function shapeKey(device) {
    const s = String(device || '').toLowerCase().trim().replace(/\s+/g, '-');
    return SHAPE_ALIAS.get(s) || '';
}
/** The shape keys whose waiters may take this instance. */
function shapesOf(dev) { return Object.keys(SHAPES).filter((k) => SHAPES[k].ids.includes(dev)); }
/** Every queue key that competes for the instances of a shape: its instances and the shape keys that overlap it. */
function overlapping(key) {
    const ids = SHAPES[key].ids;
    return ids.concat(Object.keys(SHAPES).filter((k) => SHAPES[k].ids.some((i) => ids.includes(i))));
}
const marks = (n) => new Array(n).fill('?').join(', ');

/** Devices that need Yukimi's consent by default; her settings list (coord_settings 'deviceConsent', modules/deviceConsent.js) replaces it. */
const DEFAULT_CONSENT_DEVICES = ['fold'];
// HARD RULE (Yukimi, Nov 26 2026: "no more touching my phone ... the A53 is not my phone, it's a phone for testing"): agents never
// take Yukimi's own phone (the Fold) until she says it is needed. The A53 is the test phone: agents use it without asking her
// (no consent prompt), as they use the emulators and the test browsers.
const OFF_LIMITS = new Set(['fold']);
const TEST_PHONES = new Set(['a53']);
// The Fold is reached only (Yukimi: "you only touch the Fold as the final install step, or if I approve it, or I say this is a
// priority to get done now"): purpose 'final-install' (granted, no ask), a Fleet approval window (coord setting 'foldApproval'
// { until, why, by }, set when she approves or says it is a priority now), or purpose 'approval' (she is asked on the phone).
const OFF_LIMITS_MSG = 'The Fold is Yukimi\'s own phone and off limits to agents (HARD rule, Nov 26 2026): only for the final install step (purpose final-install), when she approved it, or when she said it is a priority now. Use the A53 (your test phone: no asking) or the emulator lane.';
function foldApproval(now) {
    try { const a = store.getSetting('foldApproval'); return a && Number(a.until) > (now || Date.now()) ? a : null; } catch (_) { return null; }
}
function isPhysicalPhone(dev) {
    const d = String(dev || '').toLowerCase();
    if (!d || NEVER_CONSENT_SET.has(d) || TEST_PHONES.has(d)) return false;
    if (process.env.DEVICE_QUEUE_TEST_PHONES === '1') return false; // the consent / queue tests model phones; never set in the server
    return OFF_LIMITS.has(d);
}
/** Test browsers never ask: they are not phones, whatever a settings list says. */
const NEVER_CONSENT = new Set(['ruiko-chrome', 'headless-chrome']);
const NEVER_CONSENT_SET = NEVER_CONSENT;

let notifier = null;
let changeHook = null;
const touched = new Set();
/** fn(device): called after any state change of a device's queue (the MCP process and the server each set theirs). */
function setChangeHook(fn) { changeHook = typeof fn === 'function' ? fn : null; }
function touch(dev) { touched.add(dev); }
/** Tells the hook about every device touched since the last flush, once each. */
function flush() {
    if (!touched.size) return;
    const devs = [...touched];
    touched.clear();
    if (!changeHook) return;
    devs.forEach((dev) => { try { changeHook(dev); } catch (_) { /* a hook never breaks the queue */ } });
}
/** fn(agent, body, message): delivers a granted waiter's steer message into its terminal (the server and the MCP process each set theirs). */
function setNotifier(fn) { notifier = typeof fn === 'function' ? fn : null; }

function normalise(device) {
    const s = String(device || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9._:-]/g, '').slice(0, 40);
    if (!s) throw new Error('Which device? (a53, fold, ruiko-chrome, headless-chrome, or a name you choose)');
    return ALIAS.get(s) || s;
}

function db() { return store.open(); }

/** Device ids that need consent right now (the shared settings list, else the default). */
function consentDevices() {
    let list = DEFAULT_CONSENT_DEVICES;
    try {
        const s = store.getSetting('deviceConsent');
        if (s && Array.isArray(s.consentDevices)) list = s.consentDevices;
    } catch (_) { /* no settings yet: the default */ }
    const out = [];
    list.forEach((x) => { try { out.push(normalise(x)); } catch (_) { /* a blank entry */ } });
    return out;
}

/** Ids from the settings list testConsentDevices (#1305 S1): test devices that go through the FULL consent flow, off by default. */
function testConsentDevices() {
    let list = [];
    try {
        const s = store.getSetting('deviceConsent');
        if (s && Array.isArray(s.testConsentDevices)) list = s.testConsentDevices;
    } catch (_) { /* no settings yet: none */ }
    const out = [];
    list.forEach((x) => { try { out.push(normalise(x)); } catch (_) { /* a blank entry */ } });
    return out;
}

/** The Fold (Yukimi's own phone) and the test browsers can never be a test-lane device: their asks must reach her, never a test client. */
function canBeTestLane(device) {
    let id;
    try { id = normalise(device); } catch (_) { return false; }
    return !!id && !OFF_LIMITS.has(id) && !NEVER_CONSENT.has(id);
}

/** True for a test device (the a53 test phone, an emulator) Yukimi's settings put through the full consent flow on the test lane. */
function isTestLane(device) {
    let id;
    try { id = normalise(device); } catch (_) { return false; }
    return canBeTestLane(id) && testConsentDevices().includes(id);
}

/** True for a53, fold and any other phone Yukimi listed (settings consentDevices); a test-lane device always; never for the test browsers. */
function needsConsent(device) {
    let id;
    try { id = normalise(device); } catch (_) { return false; }
    if (NEVER_CONSENT.has(id)) return false;
    if (isTestLane(id)) return true; // listed for the consent test lane: asks like a real phone, on the test lane only
    if (TEST_PHONES.has(id) && process.env.DEVICE_QUEUE_TEST_PHONES !== '1') return false; // the test phone never asks Yukimi
    return consentDevices().includes(id);
}
const text = (v, n) => String(v == null ? '' : v).slice(0, n);

// A pending ask keeps a far-future ends_at in the DB: an agent-coord process still running the code from before consent
// existed reads a NULL end as 'lease ran out' and would end the ask on its next sweep (seen on the Fold, Nov 26 2026).
// This code ignores it while consent is pending (row() shows null) and Allow writes the real end.
const PENDING_PLACEHOLDER_MS = 12 * 60 * 60 * 1000;

function row(r) {
    return { id: r.id, device: r.device, agentId: r.agent_id, sessionId: r.session_id || '', why: r.why, minutes: r.minutes, state: r.state, requestedAt: r.requested_at, startedAt: r.started_at, endsAt: r.consent === 'pending' ? null : r.ends_at, endedAt: r.ended_at, endReason: r.end_reason, consent: r.consent || 'none', consentAt: r.consent_at || null };
}

/** Why an agent no longer deserves a device, or ''. */
function lostReason(agentId, lease, t) {
    const a = store.getAgent(agentId);
    if (!a) return 'its session is gone';
    if (a.status === 'gone' || a.status === 'done') return 'its session ended';
    if (a.pid && !store.pidAlive(a.pid)) return 'its session is gone';
    const rec = store.liveRecord(a);
    const idle = rec ? rec.status !== 'busy' : a.status === 'idle';
    if (idle) {
        const last = Math.max(Number(a.seenAt) || 0, Number(rec && rec.updatedAt) || 0, lease.started_at || 0);
        if (t - last > IDLE_MS) return 'idle for 10 minutes';
    }
    return '';
}

/** A pending ask is lost only when its agent is gone: an agent that waits for Allow is idle by nature. */
function pendingLost(h, t) {
    const why = lostReason(h.agent_id, { started_at: h.consent_at || h.requested_at }, t);
    return why === 'idle for 10 minutes' ? '' : why;
}

function finish(id, state, reason, t) {
    db().prepare('UPDATE device_queue SET state = ?, ended_at = ?, end_reason = ? WHERE id = ?').run(state, t, text(reason, 120), id);
}

function say(agentId, body) {
    try {
        const msg = store.post('agent-coord', agentId, body, { kind: 'steer' });
        const agent = store.getAgent(agentId);
        if (notifier && agent && agent.status !== 'gone') {
            let how = '';
            try { how = notifier(agent, body, msg) || ''; } catch (_) { how = ''; }
            if (how && typeof how.then === 'function') {
                // an async notifier (the server's steer): delivered only once it succeeded; a failure leaves the message unread for coord_inbox
                how.then((v) => { if (v && v !== true) { try { store.markDelivered(msg.id, String(v)); } catch (_) { /* unread stays */ } } }, () => { /* unread stays */ });
            } else if (how && how !== true) store.markDelivered(msg.id, String(how));
        }
    } catch (_) { /* the grant stands; the waiter sees it in coord_devices */ }
}

function fmtClock(ms) { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

/** Makes the next waiter of a device its holder (waiters that are gone are skipped). */
function promote(device, t) {
    const d = db();
    for (;;) {
        // the first waiter in line for this instance: one asking for it by id or one waiting on a shape that covers it (one FIFO, by id)
        const keys = [device].concat(shapesOf(device));
        const w = d.prepare(`SELECT * FROM device_queue WHERE device IN (${marks(keys.length)}) AND state = 'waiting' ORDER BY id LIMIT 1`).get(...keys);
        if (!w) return null;
        const gone = lostReason(w.agent_id, { started_at: w.requested_at }, t);
        if (gone && gone !== 'idle for 10 minutes') { finish(w.id, 'dropped', gone, t); touch(device); touch(w.device); continue; }
        touch(device);
        touch(w.device);
        if (needsConsent(device)) {
            d.prepare("UPDATE device_queue SET device = ?, state = 'held', consent = 'pending', consent_at = ?, started_at = NULL, ends_at = ? WHERE id = ?").run(device, t, t + PENDING_PLACEHOLDER_MS, w.id);
            const p = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id));
            say(p.agentId, `Device ${device} is next for you (${p.why || 'no reason given'}), but Yukimi has to tap Allow on the phone first. Do NOT touch the device (no adb, device_shell, device_screenshot, taps) until a steer message says it is allowed.`);
            return p;
        }
        d.prepare("UPDATE device_queue SET device = ?, state = 'held', started_at = ?, ends_at = ? WHERE id = ?").run(device, t, t + w.minutes * 60000, w.id);
        const g = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id));
        say(g.agentId, `Device ${device} is yours until ${fmtClock(g.endsAt)} (${g.why || 'no reason given'}). Run your test now and release it with coord_device_release when done.`);
        return g;
    }
}

/** Frees leases that ran out or lost their agent, grants the next in line (a pending ask whose agent is gone is dropped too). Touches only the given device when named. The change hook fires once the caller flushes. */
function sweepRaw(only) {
    if (only && SHAPES[only]) {
        // a shape: every instance of it is swept (leases freed, waiters on the instance or the shape promoted)
        const all = new Set();
        SHAPES[only].ids.forEach((i) => sweepRaw(i).forEach((x) => all.add(x)));
        return all;
    }
    const d = db();
    const t = store.now();
    const held = only ? d.prepare("SELECT * FROM device_queue WHERE state = 'held' AND device = ?").all(only) : d.prepare("SELECT * FROM device_queue WHERE state = 'held'").all();
    const freed = new Set();
    held.forEach((h) => {
        const why = h.consent === 'pending' ? pendingLost(h, t) : (h.ends_at <= t ? 'lease ran out' : lostReason(h.agent_id, h, t));
        if (why) {
            finish(h.id, 'expired', why, t); freed.add(h.device); touch(h.device);
            // the holder is told why it lost the device (a normal release says nothing: the agent did it)
            say(h.agent_id, h.consent === 'pending'
                ? `Your request for device ${h.device} ended (${why}) before Yukimi answered. Nothing was allowed: do NOT touch the device; request it again if you still need it.`
                : `Your lease on device ${h.device} ended (${why}). Stop testing on it; request it again if you still need it.`);
        }
    });
    // waiters whose session is gone leave the queue
    const waitKeys = only ? [only].concat(shapesOf(only)) : [];
    (only ? d.prepare(`SELECT * FROM device_queue WHERE state = 'waiting' AND device IN (${marks(waitKeys.length)})`).all(...waitKeys) : d.prepare("SELECT * FROM device_queue WHERE state = 'waiting'").all()).forEach((w) => {
        const a = store.getAgent(w.agent_id);
        if (!a || a.status === 'gone' || a.status === 'done' || (a.pid && !store.pidAlive(a.pid))) { finish(w.id, 'dropped', 'its session is gone', t); touch(w.device); }
    });
    // a free device with waiters (also after a drop) gets its next holder
    const free = only ? [only] : [...new Set(d.prepare("SELECT DISTINCT device FROM device_queue WHERE state = 'waiting'").all().flatMap((r) => (SHAPES[r.device] ? SHAPES[r.device].ids : [r.device])))];
    free.forEach((dev) => {
        if (!d.prepare("SELECT 1 FROM device_queue WHERE device = ? AND state = 'held'").get(dev)) promote(dev, t);
    });
    return freed;
}

function sweep(only) {
    const freed = sweepRaw(only);
    flush();
    return freed;
}

function mine(agentId, device, state) {
    return db().prepare('SELECT * FROM device_queue WHERE device = ? AND agent_id = ? AND state = ? ORDER BY id LIMIT 1').get(device, String(agentId), state);
}

/** A denial by a person (not a timeout) of this agent's ask for this device inside DENY_HOLD_MS, or undefined. */
function recentDenial(agentId, dev, t) {
    return db().prepare("SELECT * FROM device_queue WHERE agent_id = ? AND device = ? AND state = 'denied' AND end_reason LIKE 'denied by %' AND ended_at > ? ORDER BY id DESC LIMIT 1").get(String(agentId), dev, t - DENY_HOLD_MS);
}

function holderInfo(h) {
    const a = h && store.getAgent(h.agent_id);
    return h ? { agentId: h.agent_id, name: a ? (a.name || a.id) : h.agent_id, why: h.why, endsAt: h.ends_at } : null;
}

/** The instance of a shape this agent holds (or waits on, as the shape key), else the instance/shape as given. */
function heldIn(agentId, key) {
    const h = db().prepare(`SELECT device FROM device_queue WHERE agent_id = ? AND state = 'held' AND device IN (${marks(SHAPES[key].ids.length)}) ORDER BY id LIMIT 1`).get(String(agentId), ...SHAPES[key].ids);
    return h ? h.device : key;
}

/**
 * A shape alias (aemu-a53, aemu-fold, emulator): the first free instance is granted at once (the answer names it: device and
 * instance); only when every instance of the shape is held does the agent queue on the shape. The first instance to free up then goes
 * to the first waiter on the shape (promote), ahead of later requests, with the usual "Device <instance> is yours" steer.
 */
function requestShape(agentId, key, opts) {
    if (!store.getAgent(agentId)) throw new Error('Unknown agent: call coord_hello first');
    const shape = SHAPES[key];
    const minutes = Math.max(1, Math.min(MAX_MIN, Math.round(Number(opts.minutes)) || DEFAULT_MIN));
    shape.ids.forEach((i) => sweepRaw(i));
    const d = db();
    const t = store.now();
    const mineHeld = heldIn(agentId, key);
    if (mineHeld !== key) return Object.assign(request(agentId, mineHeld, opts), { shape: key, instance: mineHeld });
    const waiting = mine(agentId, key, 'waiting');
    if (!waiting) {
        const free = shape.ids.filter((i) => !d.prepare("SELECT 1 FROM device_queue WHERE device = ? AND state = 'held'").get(i) && !d.prepare("SELECT 1 FROM device_queue WHERE device = ? AND state = 'waiting'").get(i));
        let denied = null;
        for (const inst of free) {
            try {
                const r = request(agentId, inst, opts);
                if (r.granted || r.consent === 'pending') return Object.assign(r, { shape: key, instance: inst });
            } catch (e) { denied = denied || e; }
        }
        if (free.length && denied && free.every((i) => !mine(agentId, i, 'waiting'))) throw denied;
        const r = d.prepare("INSERT INTO device_queue (device, agent_id, session_id, why, minutes, state, requested_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)").run(key, String(agentId), text(opts.sessionId, 60), text(opts.why, 200), minutes, t);
        touch(key);
        flush();
        return queuedShapeAnswer(key, d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.lastInsertRowid));
    }
    flush();
    return queuedShapeAnswer(key, waiting);
}

function queuedShapeAnswer(key, w) {
    const d = db();
    const t = store.now();
    const keys = overlapping(key);
    const ahead = d.prepare(`SELECT COUNT(*) AS n FROM device_queue WHERE state = 'waiting' AND id < ? AND device IN (${marks(keys.length)})`).get(w.id, ...keys).n;
    const holds = d.prepare(`SELECT * FROM device_queue WHERE state = 'held' AND device IN (${marks(SHAPES[key].ids.length)}) ORDER BY ends_at`).all(...SHAPES[key].ids).map(row);
    const nameOf = (id) => { const a = store.getAgent(id); return a ? (a.name || a.id) : id; };
    const soonest = holds[0];
    return {
        granted: false, device: key, shape: key, position: ahead + 1,
        holder: soonest ? { agentId: soonest.agentId, name: nameOf(soonest.agentId), why: soonest.why, endsAt: soonest.endsAt, instance: soonest.device } : null,
        holders: holds.map((h) => ({ instance: h.device, agentId: h.agentId, name: nameOf(h.agentId), endsAt: h.endsAt })),
        eta: soonest ? (soonest.endsAt || t + soonest.minutes * 60000) : t,
        note: `Every ${SHAPES[key].name} is held: you are in line on the shape. Do not use any instance yet: a steer message names the instance when it is yours.`
    };
}

function request(agentId, device, opts = {}) {
    const sk = shapeKey(device);
    if (sk) return requestShape(agentId, sk, opts);
    const dev = normalise(device);
    let noAsk = false;
    if (isPhysicalPhone(dev)) {
        const purpose = String(opts.purpose || '').toLowerCase();
        if (purpose === 'final-install' || foldApproval()) noAsk = true;
        else if (purpose !== 'approval') throw new Error(OFF_LIMITS_MSG);
    }
    if (!store.getAgent(agentId)) throw new Error('Unknown agent: call coord_hello first');
    const minutes = Math.max(1, Math.min(MAX_MIN, Math.round(Number(opts.minutes)) || DEFAULT_MIN));
    sweepRaw(dev);
    const d = db();
    const t = store.now();
    const have = mine(agentId, dev, 'held');
    if (have) {
        if (have.consent === 'pending') {
            // still waiting for Allow: the lease length and reason may change, the clock does not run
            d.prepare('UPDATE device_queue SET minutes = ?, why = ? WHERE id = ?').run(minutes, text(opts.why, 200) || have.why, have.id);
            flush();
            return pendingAnswer(dev, row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(have.id)));
        }
        d.prepare('UPDATE device_queue SET ends_at = ?, minutes = ?, why = ? WHERE id = ?').run(t + minutes * 60000, minutes, text(opts.why, 200) || have.why, have.id);
        touch(dev);
        flush();
        return { granted: true, device: dev, lease: row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(have.id)), renewed: true };
    }
    let w = mine(agentId, dev, 'waiting');
    if (!w && !noAsk && needsConsent(dev)) {
        // Yukimi said no: the same agent does not ask again for the same phone right away (it asks her in chat first)
        const den = recentDenial(agentId, dev, t);
        if (den) {
            flush();
            throw new Error(`Yukimi denied your request for ${KNOWN[dev] ? KNOWN[dev].name : dev} ${Math.max(1, Math.round((t - den.ended_at) / 60000))} min ago. Do not ask again for ${DENY_HOLD_MS / 60000} minutes: ask her in chat first, or carry on without the device.`);
        }
    }
    if (!w) {
        const r = d.prepare("INSERT INTO device_queue (device, agent_id, session_id, why, minutes, state, requested_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)").run(dev, String(agentId), text(opts.sessionId, 60), text(opts.why, 200), minutes, t);
        w = d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.lastInsertRowid);
        if (!d.prepare("SELECT 1 FROM device_queue WHERE device = ? AND state = 'held'").get(dev)) {
            // free device and nobody ahead: granted at once (no steer message: the answer says so)
            const fk = [dev].concat(shapesOf(dev));
            const first = d.prepare(`SELECT id FROM device_queue WHERE device IN (${marks(fk.length)}) AND state = 'waiting' ORDER BY id LIMIT 1`).get(...fk);
            if (first && first.id === w.id) {
                touch(dev);
                if (noAsk) {
                    // final install step or an approval she already gave: allowed at once, never asked again
                    d.prepare("UPDATE device_queue SET state = 'held', consent = 'allowed', consent_at = ?, started_at = ?, ends_at = ? WHERE id = ?").run(t, t, t + minutes * 60000, w.id);
                    flush();
                    return { granted: true, device: dev, lease: row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id)), why: String(opts.purpose || 'approved') };
                }
                if (needsConsent(dev)) {
                    d.prepare("UPDATE device_queue SET state = 'held', consent = 'pending', consent_at = ?, started_at = NULL, ends_at = ? WHERE id = ?").run(t, t + PENDING_PLACEHOLDER_MS, w.id);
                    flush();
                    return pendingAnswer(dev, row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id)));
                }
                d.prepare("UPDATE device_queue SET state = 'held', started_at = ?, ends_at = ? WHERE id = ?").run(t, t + minutes * 60000, w.id);
                flush();
                return { granted: true, device: dev, lease: row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id)) };
            }
        }
        touch(dev);
    }
    flush();
    const st = status(dev).devices[0];
    const pos = st.queue.findIndex((q) => q.agentId === String(agentId)) + 1;
    return { granted: false, device: dev, position: pos, holder: st.holder, eta: st.queue[pos - 1] ? st.queue[pos - 1].eta : null, note: needsConsent(dev) ? 'Do not use the device yet: a steer message tells you when it is next; then Yukimi still has to tap Allow on the phone.' : 'Do not use the device yet: a steer message tells you when it is yours.' };
}

/** The answer for a phone lease that waits for Yukimi's Allow. */
function pendingAnswer(dev, lease) {
    return { granted: false, consent: 'pending', device: dev, lease, note: 'Waiting for Yukimi to tap Allow on the phone. Do NOT touch the device (no adb, device_shell, device_screenshot, taps) until a steer message says it is allowed.' };
}

function release(agentId, device) {
    const sk = shapeKey(device);
    const dev = sk ? heldIn(agentId, sk) : normalise(device);
    sweepRaw(dev);
    const t = store.now();
    const h = mine(agentId, dev, 'held');
    if (h) {
        finish(h.id, 'released', 'released', t);
        touch(dev);
        const next = promote(dev, t);
        flush();
        return { released: true, device: dev, next: next ? next.agentId : null };
    }
    const w = mine(agentId, dev, 'waiting');
    if (w) { finish(w.id, 'cancelled', 'left the queue', t); touch(dev); flush(); return { released: true, device: dev, leftQueue: true }; }
    flush();
    return { released: false, device: dev, note: 'You neither hold nor wait for this device.' };
}

function renew(agentId, device, minutes) {
    const sk = shapeKey(device);
    const dev = sk ? heldIn(agentId, sk) : normalise(device);
    sweepRaw(dev);
    const h = mine(agentId, dev, 'held');
    if (!h) { flush(); throw new Error(`You do not hold ${dev} (coord_device_request it first)`); }
    const m = Math.max(1, Math.min(MAX_MIN, Math.round(Number(minutes)) || DEFAULT_MIN));
    const t = store.now();
    if (h.consent === 'pending') {
        // nothing runs yet: only the length the lease gets once Yukimi allows
        db().prepare('UPDATE device_queue SET minutes = ? WHERE id = ?').run(m, h.id);
        flush();
        return { renewed: false, consent: 'pending', device: dev, lease: row(db().prepare('SELECT * FROM device_queue WHERE id = ?').get(h.id)), note: 'Still waiting for Yukimi to tap Allow on the phone; the lease starts then. Do NOT touch the device yet.' };
    }
    db().prepare('UPDATE device_queue SET ends_at = ?, minutes = ? WHERE id = ?').run(t + m * 60000, m, h.id);
    touch(dev);
    flush();
    return { renewed: true, device: dev, lease: row(db().prepare('SELECT * FROM device_queue WHERE id = ?').get(h.id)) };
}

/**
 * Frees one device by force (Yukimi in Fleet): the holder loses it and the next in line gets it.
 * opts.leaseId (the End on an in-use notice, #1305 S2): only that lease, and only while it is still the held, allowed one - a stale
 * End never takes a newer holder's lease or ask. Without it the device's holder goes (Fleet's own Release).
 */
function forceRelease(device, by, opts) {
    const dev = normalise(device);
    const t = store.now();
    const o = opts || {};
    const h = o.leaseId != null
        ? db().prepare("SELECT * FROM device_queue WHERE id = ? AND device = ? AND state = 'held' AND consent = 'allowed'").get(Number(o.leaseId), dev)
        : db().prepare("SELECT * FROM device_queue WHERE device = ? AND state = 'held'").get(dev);
    if (!h) return { released: false, device: dev };
    const res = db().prepare("UPDATE device_queue SET state = 'released', ended_at = ?, end_reason = ? WHERE id = ? AND state = 'held'").run(t, text(`freed by ${text(by || 'an admin', 40)}`, 120), h.id);
    if (!res.changes) return { released: false, device: dev };
    touch(dev);
    say(h.agent_id, `Your hold on device ${dev} was ended by ${text(by || 'an admin', 40)}. Stop testing on it; request it again if you still need it.`);
    const next = promote(dev, t);
    flush();
    return { released: true, device: dev, next: next ? next.agentId : null };
}

/** An agent's session ended: every lease it holds goes (next in line granted) and its places in queues. */
function releaseAgent(agentId) {
    const d = db();
    const t = store.now();
    const rows = d.prepare("SELECT * FROM device_queue WHERE agent_id = ? AND state IN ('held', 'waiting')").all(String(agentId));
    const devs = new Set();
    rows.forEach((r) => { if (r.state === 'held') devs.add(r.device); finish(r.id, r.state === 'held' ? 'released' : 'cancelled', 'its session ended', t); touch(r.device); });
    devs.forEach((dev) => promote(dev, t));
    flush();
    return rows.length;
}

/** Holders and queues, per device: the known devices always, other devices while someone holds or waits. */
function status(device) {
    const sk = device ? shapeKey(device) : '';
    const only = sk || (device ? normalise(device) : '');
    sweep(only || undefined);
    const d = db();
    const t = store.now();
    const rows = d.prepare("SELECT * FROM device_queue WHERE state IN ('held', 'waiting') ORDER BY id").all().map(row);
    const ids = sk ? [sk].concat(SHAPES[sk].ids) : only ? [only] : [...new Set(Object.keys(KNOWN).concat(rows.map((r) => r.device)))];
    const nameOf = (id) => { const a = store.getAgent(id); return a ? (a.name || a.id) : id; };
    const devices = ids.map((id) => {
        const h = rows.find((r) => r.device === id && r.state === 'held');
        let at = h ? (h.endsAt || t + h.minutes * 60000) : t;
        const queue = rows.filter((r) => r.device === id && r.state === 'waiting').map((r) => {
            const eta = at;
            at += r.minutes * 60000;
            return { agentId: r.agentId, name: nameOf(r.agentId), why: r.why, minutes: r.minutes, since: r.requestedAt, eta };
        });
        return {
            device: id, label: KNOWN[id] ? KNOWN[id].name : SHAPES[id] ? `${SHAPES[id].name} (queue on the shape)` : id,
            holder: h ? { agentId: h.agentId, name: nameOf(h.agentId), why: h.why, startedAt: h.startedAt, endsAt: h.endsAt, minutesLeft: h.endsAt ? Math.max(0, Math.ceil((h.endsAt - t) / 60000)) : h.minutes, consent: h.consent } : null,
            queue
        };
    });
    return { devices, waiting: rows.filter((r) => r.state === 'waiting').length, holding: rows.filter((r) => r.state === 'held').length };
}

/**
 * A lease granted by an agent-coord process from before consent existed (consent 'none' on a phone that needs it) is asked
 * about at its first use through the server: it becomes a pending ask (the lease clock stops until Allow). Returns the row.
 */
function requireConsent(leaseId) {
    const d = db();
    const t = store.now();
    const r = d.prepare('SELECT * FROM device_queue WHERE id = ?').get(Number(leaseId));
    if (!r || r.state !== 'held' || (r.consent || 'none') !== 'none' || !needsConsent(r.device)) return r || null;
    if (!d.prepare("UPDATE device_queue SET consent = 'pending', consent_at = ?, started_at = NULL, ends_at = ? WHERE id = ? AND state = 'held' AND consent = 'none'").run(t, t + PENDING_PLACEHOLDER_MS, r.id).changes) return d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.id);
    touch(r.device);
    flush();
    say(r.agent_id, `Device ${r.device} needs Yukimi's Allow on the phone first (your lease was granted before that rule existed). Do NOT touch it until a steer message says it is allowed.`);
    return d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.id);
}

/** The answer for a lost race: the ask was answered (or ended) by someone else between our read and our write. */
function notPending(d, id) {
    const r = d.prepare('SELECT * FROM device_queue WHERE id = ?').get(id) || {};
    return { ok: false, error: 'That ask is no longer pending', state: r.state, consent: r.consent || 'none' };
}

/**
 * Yukimi's answer for a pending ask (answered on the phone): 'allowed' starts the lease clock and tells the agent;
 * 'denied' ends the lease, tells the agent and grants the next waiter. { ok, lease } or { ok:false, error }.
 */
function setConsent(leaseId, answer, by) {
    const d = db();
    const r = d.prepare('SELECT * FROM device_queue WHERE id = ?').get(Number(leaseId));
    if (!r) return { ok: false, error: 'No such device lease' };
    if (answer !== 'allowed' && answer !== 'denied') return { ok: false, error: 'The answer is allowed or denied' };
    if (r.state !== 'held' || r.consent !== 'pending') return { ok: false, error: 'That ask is no longer pending', state: r.state, consent: r.consent || 'none' };
    const t = store.now();
    const timedOut = by === 'timeout';
    const who = text(by || 'Yukimi', 40);
    if (answer === 'allowed') {
        // guarded: another process may have answered between the read and this write (#1305 S16)
        if (!d.prepare("UPDATE device_queue SET consent = 'allowed', consent_at = ?, started_at = ?, ends_at = ? WHERE id = ? AND state = 'held' AND consent = 'pending'").run(t, t, t + r.minutes * 60000, r.id).changes) return notPending(d, r.id);
        const lease = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.id));
        say(lease.agentId, `Device ${lease.device} is allowed until ${fmtClock(lease.endsAt)} (${lease.why || 'no reason given'}). Run your test now and release it with coord_device_release when done.`);
        touch(lease.device);
        flush();
        return { ok: true, lease };
    }
    if (!d.prepare("UPDATE device_queue SET state = 'denied', consent = 'denied', consent_at = ?, ended_at = ?, end_reason = ? WHERE id = ? AND state = 'held' AND consent = 'pending'").run(t, t, timedOut ? 'denied: no answer in time' : text(`denied by ${who}`, 120), r.id).changes) return notPending(d, r.id);
    const lease = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.id));
    say(lease.agentId, timedOut
        ? `Nobody answered the ask for device ${lease.device} in time, so it was denied. Do NOT touch it. Carry on without the device, or ask Yukimi before requesting it again.`
        : `${who} denied your use of device ${lease.device}. Do NOT touch it. Carry on without the device, or ask ${who} before requesting it again.`);
    touch(lease.device);
    promote(lease.device, t);
    flush();
    return { ok: true, lease };
}

/**
 * Yukimi, Nov 27 2026 (#1305): "I should never see any consent prompts for the A53 ... I do not care about that phone". A pending
 * ask on a device that needs no consent (the A53 test phone; written by an agent-coord process still on code from before the A53
 * change) is allowed at once by the server: no notice, no sound. Returns how many it settled. Safe to call from any process.
 */
function settleNoConsent() {
    let n = 0;
    let rows = [];
    try { rows = db().prepare("SELECT id, device FROM device_queue WHERE state = 'held' AND consent = 'pending'").all(); } catch (_) { return 0; }
    for (const r of rows) {
        if (needsConsent(r.device)) continue;
        try { if (setConsent(r.id, 'allowed', 'the test phone never asks').ok) n += 1; } catch (_) { /* the next change settles it */ }
    }
    return n;
}

/**
 * The consent view the notices are built from: asks (held, pending) and holds (held, allowed and still running) - only on devices that
 * need consent: the A53 test phone (and any device off the consent list) never shows an ask or an in-use notice (#1305).
 */
function snapshotConsent() {
    const t = store.now();
    const rows = db().prepare("SELECT * FROM device_queue WHERE state = 'held' AND consent IN ('pending', 'allowed') ORDER BY id").all().map(row)
        .filter((r) => { try { return needsConsent(r.device); } catch (_) { return true; } });
    const nameOf = (id) => { const a = store.getAgent(id); return a ? (a.name || a.id) : id; };
    const lanes = new Map();
    const laneOf = (dev) => { if (!lanes.has(dev)) lanes.set(dev, isTestLane(dev) ? 'test' : 'admin'); return lanes.get(dev); };
    // lane 'test': a lease on a test-lane device (testConsentDevices); its notice goes to the test lane only, never to Yukimi's phones
    const base = (r) => Object.assign({ leaseId: r.id, device: r.device, label: KNOWN[r.device] ? KNOWN[r.device].name : r.device, agentId: r.agentId, agentName: nameOf(r.agentId), why: r.why }, laneOf(r.device) === 'test' ? { lane: 'test' } : {});
    return {
        asks: rows.filter((r) => r.consent === 'pending').map((r) => Object.assign(base(r), { minutes: r.minutes, requestedAt: r.requestedAt, consentSince: r.consentAt || r.requestedAt })),
        holds: rows.filter((r) => r.consent === 'allowed' && (!r.endsAt || r.endsAt > t)).map((r) => Object.assign(base(r), { startedAt: r.startedAt, endsAt: r.endsAt }))
    };
}

module.exports = { request, release, renew, status, releaseAgent, forceRelease, sweep, normalise, setNotifier, setChangeHook, needsConsent, isTestLane, canBeTestLane, setConsent, requireConsent, snapshotConsent, settleNoConsent, KNOWN, EMULATOR_IDS, hostOf, SHAPES, DEFAULT_CONSENT_DEVICES, isPhysicalPhone, OFF_LIMITS_MSG, foldApproval, DEFAULT_MIN, MAX_MIN, IDLE_MS, DENY_HOLD_MS };
