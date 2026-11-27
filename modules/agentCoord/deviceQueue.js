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

const KNOWN = {
    a53: { name: 'A53 phone', aliases: ['a53', 'samsung-a53', 'galaxy-a53', 'a53-phone', 'phone'] },
    fold: { name: 'Fold', aliases: ['fold', 'z-fold', 'zfold', 'galaxy-fold', 'fold-phone'] },
    'ruiko-chrome': { name: 'Ruiko headful Chrome (CDP 9335)', aliases: ['ruiko-chrome', 'ruiko', 'chrome-9335', 'cdp-9335', '9335', 'headful-chrome', 'gpu-chrome'] },
    'headless-chrome': { name: 'Shared headless browser (:9333)', aliases: ['headless-chrome', 'headless', 'chrome-9333', 'cdp-9333', '9333', 'shared-browser', 'test-browser'] }
};
const ALIAS = new Map();
Object.keys(KNOWN).forEach((id) => KNOWN[id].aliases.forEach((a) => ALIAS.set(a, id)));

/** Devices that need Yukimi's consent by default; her settings list (coord_settings 'deviceConsent', modules/deviceConsent.js) replaces it. */
const DEFAULT_CONSENT_DEVICES = ['a53', 'fold'];
/** Test browsers never ask: they are not phones, whatever a settings list says. */
const NEVER_CONSENT = new Set(['ruiko-chrome', 'headless-chrome']);

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

/** True for a53, fold and any other phone Yukimi listed (settings consentDevices); never for the test browsers. */
function needsConsent(device) {
    let id;
    try { id = normalise(device); } catch (_) { return false; }
    if (NEVER_CONSENT.has(id)) return false;
    return consentDevices().includes(id);
}
const text = (v, n) => String(v == null ? '' : v).slice(0, n);

function row(r) {
    return { id: r.id, device: r.device, agentId: r.agent_id, sessionId: r.session_id || '', why: r.why, minutes: r.minutes, state: r.state, requestedAt: r.requested_at, startedAt: r.started_at, endsAt: r.ends_at, endedAt: r.ended_at, endReason: r.end_reason, consent: r.consent || 'none', consentAt: r.consent_at || null };
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
            if (how && how !== true) store.markDelivered(msg.id, String(how));
        }
    } catch (_) { /* the grant stands; the waiter sees it in coord_devices */ }
}

function fmtClock(ms) { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

/** Makes the next waiter of a device its holder (waiters that are gone are skipped). */
function promote(device, t) {
    const d = db();
    for (;;) {
        const w = d.prepare("SELECT * FROM device_queue WHERE device = ? AND state = 'waiting' ORDER BY id LIMIT 1").get(device);
        if (!w) return null;
        const gone = lostReason(w.agent_id, { started_at: w.requested_at }, t);
        if (gone && gone !== 'idle for 10 minutes') { finish(w.id, 'dropped', gone, t); touch(device); continue; }
        touch(device);
        if (needsConsent(device)) {
            d.prepare("UPDATE device_queue SET state = 'held', consent = 'pending', consent_at = ?, started_at = NULL, ends_at = NULL WHERE id = ?").run(t, w.id);
            const p = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id));
            say(p.agentId, `Device ${device} is next for you (${p.why || 'no reason given'}), but Yukimi has to tap Allow on the phone first. Do NOT touch the device (no adb, device_shell, device_screenshot, taps) until a steer message says it is allowed.`);
            return p;
        }
        d.prepare("UPDATE device_queue SET state = 'held', started_at = ?, ends_at = ? WHERE id = ?").run(t, t + w.minutes * 60000, w.id);
        const g = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(w.id));
        say(g.agentId, `Device ${device} is yours until ${fmtClock(g.endsAt)} (${g.why || 'no reason given'}). Run your test now and release it with coord_device_release when done.`);
        return g;
    }
}

/** Frees leases that ran out or lost their agent, grants the next in line (a pending ask whose agent is gone is dropped too). Touches only the given device when named. The change hook fires once the caller flushes. */
function sweepRaw(only) {
    const d = db();
    const t = store.now();
    const held = only ? d.prepare("SELECT * FROM device_queue WHERE state = 'held' AND device = ?").all(only) : d.prepare("SELECT * FROM device_queue WHERE state = 'held'").all();
    const freed = new Set();
    held.forEach((h) => {
        const why = h.consent === 'pending' ? pendingLost(h, t) : (h.ends_at <= t ? 'lease ran out' : lostReason(h.agent_id, h, t));
        if (why) { finish(h.id, 'expired', why, t); freed.add(h.device); touch(h.device); }
    });
    // waiters whose session is gone leave the queue
    (only ? d.prepare("SELECT * FROM device_queue WHERE state = 'waiting' AND device = ?").all(only) : d.prepare("SELECT * FROM device_queue WHERE state = 'waiting'").all()).forEach((w) => {
        const a = store.getAgent(w.agent_id);
        if (!a || a.status === 'gone' || a.status === 'done' || (a.pid && !store.pidAlive(a.pid))) { finish(w.id, 'dropped', 'its session is gone', t); touch(w.device); }
    });
    // a free device with waiters (also after a drop) gets its next holder
    const free = only ? [only] : d.prepare("SELECT DISTINCT device FROM device_queue WHERE state = 'waiting'").all().map((r) => r.device);
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

function holderInfo(h) {
    const a = h && store.getAgent(h.agent_id);
    return h ? { agentId: h.agent_id, name: a ? (a.name || a.id) : h.agent_id, why: h.why, endsAt: h.ends_at } : null;
}

function request(agentId, device, opts = {}) {
    const dev = normalise(device);
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
    if (!w) {
        const r = d.prepare("INSERT INTO device_queue (device, agent_id, session_id, why, minutes, state, requested_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)").run(dev, String(agentId), text(opts.sessionId, 60), text(opts.why, 200), minutes, t);
        w = d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.lastInsertRowid);
        if (!d.prepare("SELECT 1 FROM device_queue WHERE device = ? AND state = 'held'").get(dev)) {
            // free device and nobody ahead: granted at once (no steer message: the answer says so)
            const first = d.prepare("SELECT id FROM device_queue WHERE device = ? AND state = 'waiting' ORDER BY id LIMIT 1").get(dev);
            if (first && first.id === w.id) {
                touch(dev);
                if (needsConsent(dev)) {
                    d.prepare("UPDATE device_queue SET state = 'held', consent = 'pending', consent_at = ?, started_at = NULL, ends_at = NULL WHERE id = ?").run(t, w.id);
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
    const dev = normalise(device);
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
    const dev = normalise(device);
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

/** Frees one device by force (Yukimi in Fleet): the holder loses it and the next in line gets it. */
function forceRelease(device, by) {
    const dev = normalise(device);
    const t = store.now();
    const h = db().prepare("SELECT * FROM device_queue WHERE device = ? AND state = 'held'").get(dev);
    if (!h) return { released: false, device: dev };
    finish(h.id, 'released', `freed by ${text(by || 'an admin', 40)}`, t);
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
    const only = device ? normalise(device) : '';
    sweep(only || undefined);
    const d = db();
    const t = store.now();
    const rows = d.prepare("SELECT * FROM device_queue WHERE state IN ('held', 'waiting') ORDER BY id").all().map(row);
    const ids = only ? [only] : [...new Set(Object.keys(KNOWN).concat(rows.map((r) => r.device)))];
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
            device: id, label: KNOWN[id] ? KNOWN[id].name : id,
            holder: h ? { agentId: h.agentId, name: nameOf(h.agentId), why: h.why, startedAt: h.startedAt, endsAt: h.endsAt, minutesLeft: h.endsAt ? Math.max(0, Math.ceil((h.endsAt - t) / 60000)) : h.minutes, consent: h.consent } : null,
            queue
        };
    });
    return { devices, waiting: rows.filter((r) => r.state === 'waiting').length, holding: rows.filter((r) => r.state === 'held').length };
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
        d.prepare("UPDATE device_queue SET consent = 'allowed', consent_at = ?, started_at = ?, ends_at = ? WHERE id = ?").run(t, t, t + r.minutes * 60000, r.id);
        const lease = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.id));
        say(lease.agentId, `Device ${lease.device} is allowed until ${fmtClock(lease.endsAt)} (${lease.why || 'no reason given'}). Run your test now and release it with coord_device_release when done.`);
        touch(lease.device);
        flush();
        return { ok: true, lease };
    }
    d.prepare("UPDATE device_queue SET state = 'denied', consent = 'denied', consent_at = ?, ended_at = ?, end_reason = ? WHERE id = ?").run(t, t, timedOut ? 'denied: no answer in time' : text(`denied by ${who}`, 120), r.id);
    const lease = row(d.prepare('SELECT * FROM device_queue WHERE id = ?').get(r.id));
    say(lease.agentId, timedOut
        ? `Nobody answered the ask for device ${lease.device} in time, so it was denied. Do NOT touch it. Carry on without the device, or ask Yukimi before requesting it again.`
        : `${who} denied your use of device ${lease.device}. Do NOT touch it. Carry on without the device, or ask ${who} before requesting it again.`);
    touch(lease.device);
    promote(lease.device, t);
    flush();
    return { ok: true, lease };
}

/** The consent view the notices are built from: asks (held, pending) and holds (held, allowed and still running). */
function snapshotConsent() {
    const t = store.now();
    const rows = db().prepare("SELECT * FROM device_queue WHERE state = 'held' AND consent IN ('pending', 'allowed') ORDER BY id").all().map(row);
    const nameOf = (id) => { const a = store.getAgent(id); return a ? (a.name || a.id) : id; };
    const base = (r) => ({ leaseId: r.id, device: r.device, label: KNOWN[r.device] ? KNOWN[r.device].name : r.device, agentId: r.agentId, agentName: nameOf(r.agentId), why: r.why });
    return {
        asks: rows.filter((r) => r.consent === 'pending').map((r) => Object.assign(base(r), { minutes: r.minutes, requestedAt: r.requestedAt, consentSince: r.consentAt || r.requestedAt })),
        holds: rows.filter((r) => r.consent === 'allowed' && (!r.endsAt || r.endsAt > t)).map((r) => Object.assign(base(r), { startedAt: r.startedAt, endsAt: r.endsAt }))
    };
}

module.exports = { request, release, renew, status, releaseAgent, forceRelease, sweep, normalise, setNotifier, setChangeHook, needsConsent, setConsent, snapshotConsent, KNOWN, DEFAULT_CONSENT_DEVICES, DEFAULT_MIN, MAX_MIN, IDLE_MS };
