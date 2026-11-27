'use strict';

/**
 * Consent for shared test phones (Yozora #1284). A lease on a phone (a53, fold, any ActiveSync phone Yukimi
 * listed) starts as 'held' with consent 'pending' (modules/agentCoord/deviceQueue.js); only her Allow, answered
 * on the phone, makes it usable. This module runs in the Dreamscape server and owns:
 *
 *   - the settings (stored in the agent-coord DB so the MCP processes and the server read the same values),
 *   - changed(device): called by deviceQueue's change hook (directly in the server, over supervisor.sock from the
 *     MCP process) after every queue change; it hands the current asks and holds to deviceConsentNotices.sync()
 *     and arms ONE timeout per pending ask (no polling),
 *   - answer(): Allow / Deny from the phone (the ws handler, the native notification buttons),
 *   - check(target, action, caller): the gate deviceAdb asks before an agent's shell / screenshot / package call touches a phone.
 *     A phone lease is its holder's alone (#1305 S3): the caller ({ agentId?, sessionId?, human? }, built by the tool's server side)
 *     must be the holder, else the call is refused; a call that names nobody is refused (fail closed).
 *
 * Test lane (#1305 S1): the setting testConsentDevices (default none) lists test devices - the a53 test phone, emulators - that go
 * through this whole flow for testing. A lease on one asks like a phone, but its asks and holds are marked lane 'test' and reach the
 * test lane only (a test-lane client answers them; Yukimi's phones never see them). The Fold and the test browsers can never be on it.
 *
 * The ask timeout never grants by itself: with onTimeout 'wait' (default) the ask stays pending and its notice
 * only goes quiet; 'deny' and 'allow' are modes Yukimi chooses. A restarted server rebuilds everything from the
 * DB (resync): the timeout counts from the ask's consent_since, so a restart does not lose or restart it.
 */

const store = require('./agentCoord/store');
const dq = require('./agentCoord/deviceQueue');

const SETTINGS_KEY = 'deviceConsent';
const DEFAULTS = Object.freeze({ timeoutSec: 60, onTimeout: 'wait', readOnly: 'ask', consentDevices: Object.freeze(['a53', 'fold']), testConsentDevices: Object.freeze([]) });
const ON_TIMEOUT = ['wait', 'deny', 'allow'];
const READ_ONLY = ['ask', 'allow'];
const MIN_TIMEOUT_SEC = 1;
const MAX_TIMEOUT_SEC = 3600;
const MAX_DEVICES = 20;
/** A denial still explains "denied" to a gate call for this long when nobody holds the device. */
const DENIED_NOTE_MS = 10 * 60 * 1000;
const HINT = 'coord_device_request it, then wait for Allow on the phone';
const HOLD_OVER = 'That hold is over';
/** A pending ask whose agent session died is swept at most this long after the ask was made (#1305 S11): one timer, no polling. */
const PENDING_SWEEP_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- settings

function cleanDevices(list) {
    const out = [];
    (Array.isArray(list) ? list : []).slice(0, MAX_DEVICES).forEach((x) => {
        let id = '';
        try { id = dq.normalise(x); } catch (_) { id = ''; }
        if (id && !out.includes(id)) out.push(id);
    });
    return out;
}

/** The test-lane list: cleanDevices without the ids that can never be a test device (the Fold, the test browsers). */
function cleanTestDevices(list) {
    return cleanDevices(list).filter((id) => dq.canBeTestLane(id));
}

/** The settings with every field valid (a bad stored value falls back to its default). */
function settings() {
    let s = null;
    try { s = store.getSetting(SETTINGS_KEY); } catch (_) { s = null; }
    s = s && typeof s === 'object' ? s : {};
    const t = Math.round(Number(s.timeoutSec));
    return {
        timeoutSec: t >= MIN_TIMEOUT_SEC && t <= MAX_TIMEOUT_SEC ? t : DEFAULTS.timeoutSec,
        onTimeout: ON_TIMEOUT.includes(s.onTimeout) ? s.onTimeout : DEFAULTS.onTimeout,
        readOnly: READ_ONLY.includes(s.readOnly) ? s.readOnly : DEFAULTS.readOnly,
        consentDevices: Array.isArray(s.consentDevices) ? cleanDevices(s.consentDevices) : DEFAULTS.consentDevices.slice(),
        testConsentDevices: Array.isArray(s.testConsentDevices) ? cleanTestDevices(s.testConsentDevices) : []
    };
}

/** Merges a patch into the stored settings; throws on an invalid field. Returns the settings now in force. */
function setSettings(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const cur = settings();
    if (p.timeoutSec !== undefined) {
        const t = Math.round(Number(p.timeoutSec));
        if (!Number.isFinite(t) || t < MIN_TIMEOUT_SEC || t > MAX_TIMEOUT_SEC) throw new Error(`timeoutSec must be ${MIN_TIMEOUT_SEC} to ${MAX_TIMEOUT_SEC} seconds`);
        cur.timeoutSec = t;
    }
    if (p.onTimeout !== undefined) {
        if (!ON_TIMEOUT.includes(p.onTimeout)) throw new Error(`onTimeout must be ${ON_TIMEOUT.join(', ')}`);
        cur.onTimeout = p.onTimeout;
    }
    if (p.readOnly !== undefined) {
        if (!READ_ONLY.includes(p.readOnly)) throw new Error(`readOnly must be ${READ_ONLY.join(' or ')}`);
        cur.readOnly = p.readOnly;
    }
    if (p.consentDevices !== undefined) {
        if (!Array.isArray(p.consentDevices)) throw new Error('consentDevices must be a list of device ids');
        cur.consentDevices = cleanDevices(p.consentDevices);
    }
    if (p.testConsentDevices !== undefined) {
        // test devices (the a53 test phone, emulators) that go through the full consent flow on the test lane; off by default
        if (!Array.isArray(p.testConsentDevices)) throw new Error('testConsentDevices must be a list of device ids');
        const wanted = cleanDevices(p.testConsentDevices);
        const bad = wanted.filter((id) => !dq.canBeTestLane(id));
        if (bad.length) throw new Error(`testConsentDevices cannot include ${bad.join(', ')} (the Fold is Yukimi's own phone and the test browsers never ask): its asks must reach her`);
        cur.testConsentDevices = wanted;
    }
    store.setSetting(SETTINGS_KEY, cur);
    resync();
    return settings();
}

// ---------------------------------------------------------------- notices and timeouts

let noticesOverride = null;
let warned = false;
/** The notices module is written separately and may be missing: it is loaded lazily and never throws. */
function notices() {
    if (noticesOverride) return noticesOverride;
    try {
        return require('./deviceConsentNotices');
    } catch (e) {
        if (!(e && e.code === 'MODULE_NOT_FOUND' && /deviceConsentNotices/.test(String(e.message))) && !warned) {
            warned = true;
            console.warn(`[deviceConsent] notices unavailable: ${e && e.message}`);
        }
        return null;
    }
}

/** ask leaseId -> { timer, at } (the deadline the timer was armed for) */
const askTimers = new Map();
/** leaseIds whose timeout passed while the ask stayed pending: their notice goes quiet */
const quiet = new Set();
let holdTimer = null;
let lastSig = '';

function clearAskTimer(id) {
    const e = askTimers.get(id);
    if (e) { clearTimeout(e.timer); askTimers.delete(id); }
}

/** The ask's timeout passed: the notice goes quiet, or (only when she chose it) the ask is denied or allowed. */
function expire(leaseId) {
    askTimers.delete(leaseId);
    let snap;
    try { snap = dq.snapshotConsent(); } catch (_) { return; }
    const ask = snap.asks.find((a) => a.leaseId === leaseId);
    if (!ask) { quiet.delete(leaseId); return; }
    const mode = settings().onTimeout;
    if (mode === 'deny' || mode === 'allow') {
        const r = dq.setConsent(leaseId, mode === 'deny' ? 'denied' : 'allowed', 'timeout');
        quiet.delete(leaseId);
        if (r.ok) { changed(ask.device); return; }
    }
    quiet.add(leaseId);
    changed(ask.device, true);
}

/** One timeout per pending ask; asks that are not pending any more lose theirs. */
function armAsks(asks, cfg) {
    const ids = new Set(asks.map((a) => a.leaseId));
    [...askTimers.keys()].forEach((id) => { if (!ids.has(id)) clearAskTimer(id); });
    [...quiet].forEach((id) => { if (!ids.has(id)) quiet.delete(id); });
    const now = Date.now();
    asks.forEach((a) => {
        const at = (a.consentSince || a.requestedAt || now) + cfg.timeoutSec * 1000;
        const have = askTimers.get(a.leaseId);
        if (have && have.at === at) return;
        clearAskTimer(a.leaseId);
        quiet.delete(a.leaseId);
        if (at <= now && cfg.onTimeout === 'wait') { quiet.add(a.leaseId); return; } // passed already (a restart, a shorter setting)
        const timer = setTimeout(() => expire(a.leaseId), Math.max(0, at - now));
        if (timer.unref) timer.unref();
        askTimers.set(a.leaseId, { timer, at });
    });
}

/** One deadline timer for the earliest running lease, so a hold notice goes when its lease runs out without anyone touching the queue. */
function armHold(holds) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    const ends = holds.map((h) => h.endsAt).filter((x) => x > 0);
    if (!ends.length) return;
    const delay = Math.min(2147483000, Math.max(250, Math.min(...ends) - Date.now() + 250));
    holdTimer = setTimeout(() => { holdTimer = null; try { dq.sweep(); } catch (_) { /* the next change settles it */ } }, delay);
    if (holdTimer.unref) holdTimer.unref();
}

let pendingTimer = null;
let pendingAt = 0;
let lastPendingSweepAt = 0;
let pendingSweepMs = PENDING_SWEEP_MS;
/**
 * One unref'd timeout for the earliest pending ask (#1305 S11): a pending ask whose agent session died, with the poke from its MCP
 * process lost, is swept (dq.sweep drops it and clears its notice) within pendingSweepMs. Re-armed on a change, never polling: it
 * fires once, sweeps, and arms again only while an ask is still pending.
 */
function armPending(asks) {
    if (!asks.length) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; pendingAt = 0; }
        return;
    }
    const now = Date.now();
    const earliest = Math.min(...asks.map((a) => a.consentSince || a.requestedAt || now));
    // pendingSweepMs after the ask was made or after the last sweep, whichever is later (an old ask found at a server start: one sweep soon, then every pendingSweepMs)
    const at = Math.max(Math.max(earliest, lastPendingSweepAt) + pendingSweepMs, now + 1000);
    if (pendingTimer && pendingAt <= at) return; // it fires no later than needed
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingAt = at;
    pendingTimer = setTimeout(() => {
        pendingTimer = null; pendingAt = 0; lastPendingSweepAt = Date.now();
        try { dq.sweep(); } catch (_) { /* the next change settles it */ }
        changed('', false); // re-arms while an ask is still pending; an unchanged picture is not sent again
    }, Math.min(2147483000, at - now));
    if (pendingTimer.unref) pendingTimer.unref();
}

/**
 * A device's queue changed (any process): rebuild the timers and hand the asks and holds to the notices.
 * An unchanged picture is not sent twice (force: resync after a start or a settings change).
 */
function changed(device, force) {
    let snap;
    let cfg;
    // an ask on the A53 test phone (an old agent-coord process wrote it) is allowed at once, never shown (Yukimi, Nov 27 2026)
    try { if (typeof dq.settleNoConsent === 'function') dq.settleNoConsent(); } catch (_) { /* the snapshot still leaves it out */ }
    try { snap = dq.snapshotConsent(); cfg = settings(); } catch (_) { return; }
    armAsks(snap.asks, cfg);
    armHold(snap.holds);
    armPending(snap.asks);
    const sig = JSON.stringify([snap.asks.map((a) => [a.leaseId, a.minutes, a.why, quiet.has(a.leaseId), a.lane || '']), snap.holds.map((h) => [h.leaseId, h.endsAt, h.why, h.lane || '']), cfg.timeoutSec, cfg.onTimeout]);
    if (!force && sig === lastSig) return;
    const n = notices();
    if (!n || typeof n.sync !== 'function') return;
    try {
        n.sync(snap, cfg, { quiet: new Set(quiet) });
        lastSig = sig;
    } catch (e) {
        console.warn(`[deviceConsent] notices sync failed: ${e && e.message}`);
    }
}

/** At server start (and after a settings change): the notices and timers come back from the DB. */
function resync() {
    changed('', true);
}

/** Server start: queue changes reach changed() directly, and the DB state is shown again. */
function start() {
    dq.setChangeHook(changed);
    setImmediate(resync); // not on the boot path
}

/** The lane an ask / hold belongs to: 'test' for a test-lane device (testConsentDevices), else the household's ('admin'). */
function laneOfDevice(device) { return dq.isTestLane(device) ? 'test' : 'admin'; }

/** The lane of a pending ask by lease id ('test' | 'admin'), or null when no such ask is pending (the handler checks it before answering). */
function askLane(leaseId) {
    try {
        const ask = dq.snapshotConsent().asks.find((a) => a.leaseId === Number(leaseId));
        return ask ? (ask.lane === 'test' ? 'test' : 'admin') : null;
    } catch (_) { return null; }
}

/**
 * Yukimi's answer for a pending ask: 'allow' | 'deny'. { ok, lease? } or { ok:false, error }.
 * opts.clientLane: the lane of the client that answers ('test' for a test device, else household): a test-lane client answers only
 * an ask on the test lane (its own device's); an admin client answers either.
 */
function answer(leaseId, ans, by, opts) {
    if (ans !== 'allow' && ans !== 'deny') return { ok: false, error: 'The answer is allow or deny' };
    let ask;
    try { ask = dq.snapshotConsent().asks.find((a) => a.leaseId === Number(leaseId)); } catch (e) { return { ok: false, error: e.message }; }
    if (!ask) return { ok: false, error: 'That ask is not pending (already answered, released or gone)' };
    if (opts && opts.clientLane === 'test' && ask.lane !== 'test') return { ok: false, error: 'test device' };
    const r = dq.setConsent(ask.leaseId, ans === 'allow' ? 'allowed' : 'denied', by || 'Yukimi');
    if (!r.ok) return { ok: false, error: r.error === 'That ask is no longer pending' ? 'That ask is not pending (already answered, released or gone)' : r.error };
    changed(ask.device);
    return { ok: true, lease: r.lease };
}

/**
 * End on the in-use notice: the holder of the device loses it now (it is told) and the next in line is asked about.
 * opts.leaseId is the lease the notice was about (its data.leaseId): only that lease ends, and only while it is still the held,
 * allowed one - a stale End never ends a newer holder's lease or a pending ask (#1305 S2). Without a lease id nothing ends.
 * opts.clientLane as in answer().
 */
function endHold(device, by, opts) {
    const o = opts || {};
    let dev = '';
    try { dev = dq.normalise(device); } catch (e) { return { ok: false, error: e.message }; }
    const leaseId = Number(o.leaseId);
    if (!Number.isFinite(leaseId) || leaseId <= 0) return { ok: false, error: HOLD_OVER };
    if (o.clientLane === 'test' && !dq.isTestLane(dev)) return { ok: false, error: 'test device' };
    let r;
    try {
        dq.sweep(dev); // a lease that ran out is over, not endable
        r = dq.forceRelease(dev, by || 'Yukimi', { leaseId });
    } catch (e) { return { ok: false, error: e.message }; }
    changed(dev);
    return r && r.released ? { ok: true, device: dev } : { ok: false, error: HOLD_OVER };
}

// ---------------------------------------------------------------- the gate

/** Which queue device a target is: a table to extend (name / model patterns), else the id when it is listed. */
const TARGET_MATCHERS = [
    { device: 'fold', re: /fold|sm-f9\d\d|\bf9\d\d[a-z]?\b/i },
    { device: 'a53', re: /a53|sm-a536|\ba536[a-z]?\b/i }
];

/** target = { deviceId, name, model } -> queue device id, or '' when it is no known shared phone. */
function deviceFor(target) {
    const t = target || {};
    const parts = [t.deviceId, t.name, t.model].map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
    const listed = dq.needsConsent;
    for (const p of parts) {
        let id = '';
        try { id = dq.normalise(p); } catch (_) { id = ''; }
        if (id && (dq.KNOWN[id] || listed(id))) return id;
    }
    const hay = parts.join(' ');
    for (const m of TARGET_MATCHERS) if (m.re.test(hay)) return m.device;
    return '';
}

/**
 * dumpsys only for services that are plain reads, with nothing after the service name but the one sub-view a caller here uses (#1305
 * S13): `dumpsys procstats --clear`, `dumpsys sensorservice restrict x`, `dumpsys battery set ...` and any flag are NOT read-only.
 */
const DUMPSYS_READ = /^dumpsys\s+(?:(?:battery|batterystats|display|account|notification|audio|power|wifi|connectivity|meminfo|cpuinfo|SurfaceFlinger)|window(?:\s+(?:windows|displays))?|activity\s+activities)$/;
const SAFE_ARGS = /^[A-Za-z0-9_.:/=@,+*%'" -]*$/;
const READ_ONLY_RULES = [
    (c) => DUMPSYS_READ.test(c),
    (c) => /^getprop(\s|$)/.test(c),
    // logcat as a dump only (-d, ends by itself): never -c (clears), -G / -P (buffer size, prune list), -f (writes a file)
    (c) => /^logcat(\s|$)/.test(c) && /(^|\s)-d(\s|$)/.test(c)
        && /^logcat(\s+(-d|-t\s+\d{1,6}|-T\s+\d{1,6}|-b\s+[a-z]+(,[a-z]+)*|-v\s+[a-z]+|-s|--pid[= ]\d{1,7}|[A-Za-z0-9_.-]+:[VDIWEFS]|\*:[VDIWEFS]))*$/.test(c),
    (c) => /^pm\s+(list|path|dump)(\s|$)/.test(c),
    (c) => /^settings\s+get\s/.test(c),
    (c) => /^cat\s+\/proc\/[A-Za-z0-9_./-]*$/.test(c) && !c.includes('..'),
    (c) => /^ls(\s|$)/.test(c),
    (c) => /^df(\s|$)/.test(c),
    (c) => /^uptime$/.test(c),
    (c) => /^wm\s+(size|density)$/.test(c),
    // `ip <object>` and `ip <object> show [dev] [iface]` only: `ip addr flush`, `ip link set`, `ip route flush` change the network
    (c) => /^ip\s+(addr|address|a|route|r|link|neigh|neighbor)(\s+show(\s+(dev\s+)?[A-Za-z0-9._-]+)?)?$/.test(c),
    (c) => /^ping\s+-c\s+\d{1,2}\s+[A-Za-z0-9._:-]+$/.test(c)
];
/** Filters that may follow a pipe: they only read their input (not `tail -f`, which never ends, nor grep reading files or directories: -f -r -R). */
const PIPE_FILTERS = /^(grep|head|tail|wc|cut)(\s|$)/;
const TAIL_FOLLOW = /(^|\s)(-[A-Za-z0-9]*[fF][A-Za-z0-9]*|--follow)(\s|=|$)/;
const GREP_FILES = /(^|\s)(-[A-Za-z0-9]*[frR][A-Za-z0-9]*|--(file|recursive|dereference-recursive))(\s|=|$)/;
function pipeFilterOk(seg) {
    if (!PIPE_FILTERS.test(seg)) return false;
    if (/^tail(\s|$)/.test(seg)) return !TAIL_FOLLOW.test(seg);
    if (/^grep(\s|$)/.test(seg)) return !GREP_FILES.test(seg);
    return true; // head, wc, cut (cut -f is a field list)
}

/** True when a shell command only reads: every segment is on the allowlist, with no `;`, redirect, substitution or write. */
function isReadOnlyShell(command) {
    const c = String(command == null ? '' : command).trim();
    if (!c || c.length > 400) return false;
    if (/[;<>`$\\\n\r&]/.test(c.replace(/&&/g, ''))) return false;
    if (!SAFE_ARGS.test(c.replace(/&&|\|\|?/g, ' '))) return false;
    const segs = c.split(/&&|\|\|?/).map((x) => x.trim());
    const joiners = c.match(/&&|\|\|?/g) || [];
    return segs.every((seg, i) => {
        if (!seg) return false;
        if (i > 0 && joiners[i - 1] === '|') return READ_ONLY_RULES.some((r) => r(seg)) || pipeFilterOk(seg);
        return READ_ONLY_RULES.some((r) => r(seg));
    });
}

function holderOf(r) {
    if (!r) return null;
    const a = store.getAgent(r.agent_id);
    return { agentId: r.agent_id, name: a ? (a.name || a.id) : r.agent_id, why: r.why, endsAt: r.consent === 'pending' ? null : (r.ends_at || null), consent: r.consent || 'none' };
}

/**
 * The gate: may this call touch this target now?
 * target = { deviceId, name, model }, action = { kind: 'screenshot' | 'shell' | 'packages-read' | 'packages-write', command? }
 * -> { ok:true, lease? } or { ok:false, code: DEVICE_NOT_GRANTED | DEVICE_PENDING | DEVICE_DENIED, error, holder, hint }
 */
/**
 * An emulator: the adb serial emulator-NNNN, or a model string the emulator reports (sdk_gphone, ranchu, goldfish, the aemu AVD model).
 * Never the free-form device name (#1305 S14): a real phone named "emulator" would skip the gate.
 */
function isEmulatorTarget(target) {
    const t = target || {};
    return /^emulator-\d+$/i.test(String(t.deviceId || '')) || /sdk_gphone|ranchu|goldfish|google_sdk|generic_x86|\baemu\b/i.test(String(t.model || ''));
}

/**
 * True when the lease holder h is the caller. The caller is { agentId?, sessionId?, human? } as the device tool's server side knows it
 * (never the tool's own claim about someone else: the facade builds it). An agent id or a session id (the lease's, or the holder
 * agent's registered one) must match exactly.
 */
function holderIs(h, caller) {
    if (!h || !caller || typeof caller !== 'object') return false;
    const aid = String(caller.agentId || '').trim().toLowerCase();
    const sid = String(caller.sessionId || '').trim().toLowerCase();
    if (aid && aid === String(h.agent_id || '').toLowerCase()) return true;
    if (!sid) return false;
    if (h.session_id && sid === String(h.session_id).toLowerCase()) return true;
    try { const a = store.getAgent(h.agent_id); return !!(a && a.sessionId && sid === String(a.sessionId).toLowerCase()); } catch (_) { return false; }
}

/** An action Yukimi cannot see, hear or feel on the phone: reading packages, a screenshot, a read-only shell command. */
function imperceptible(act) {
    const a = act || {};
    return a.kind === 'packages-read' || a.kind === 'screenshot' || (a.kind === 'shell' && isReadOnlyShell(a.command));
}

function check(target, action, caller) {
    const dev = deviceFor(target);
    // a test-lane device (the a53 test phone or an emulator Yukimi's settings list in testConsentDevices) takes the full flow below
    const testLane = !!dev && dq.isTestLane(dev);
    // the emulator lane is where agents test phones (Yukimi, Nov 26 2026): an emulator is open to agents unless it is on the test lane
    if (!testLane && isEmulatorTarget(target)) return { ok: true, lease: null, device: String((target && (target.name || target.deviceId)) || 'emulator'), emulator: true };
    // a phone this table does not know is closed, never open (Yukimi: no agent takes a phone she was not asked about);
    // its name goes in TARGET_MATCHERS / the consentDevices setting to be requested like the Fold
    if (!dev) return { ok: false, code: 'DEVICE_NOT_GRANTED', error: 'This phone is not in the shared-device list (consentDevices): ask Yukimi to add it before an agent uses it', device: null, holder: null, hint: HINT };
    // HARD (Yukimi, Nov 26 2026): her own phone (the Fold) only on an allowed lease - the final install step, her approval, or a
    // priority she named (deviceQueue.request) - except what she cannot perceive (Nov 27, below). The A53 test phone is open (no ask).
    const offLimits = dq.isPhysicalPhone(dev);
    const act = action || {};
    // Yukimi, Nov 27 2026: "you can access the Fold at any time if it's read only or is not perceivable to me (no touch)": a
    // package list, a screenshot, a read-only shell (logcat, dumpsys of the listed services, getprop ...) pass with no lease and
    // no ask, whatever the readOnly setting says; anything she can see, hear or feel (input, installs, app starts / stops,
    // settings writes, reboots) still needs the allowed lease above
    if (offLimits && imperceptible(act)) return { ok: true, lease: null, device: dev, readOnly: true, imperceptible: true };
    if (!dq.needsConsent(dev)) return { ok: true, lease: null, device: dev };
    const cfg = settings();
    if (!offLimits && cfg.readOnly === 'allow' && (act.kind === 'packages-read' || (act.kind === 'shell' && isReadOnlyShell(act.command)))) {
        return { ok: true, lease: null, device: dev, readOnly: true };
    }
    const label = dq.KNOWN[dev] ? dq.KNOWN[dev].name : dev;
    let h = null;
    let denied = null;
    try {
        dq.sweep(dev);
        const d = store.open();
        h = d.prepare("SELECT * FROM device_queue WHERE device = ? AND state = 'held' ORDER BY id LIMIT 1").get(dev);
        if (!h) denied = d.prepare("SELECT * FROM device_queue WHERE device = ? AND state = 'denied' AND ended_at > ? ORDER BY id DESC LIMIT 1").get(dev, Date.now() - DENIED_NOTE_MS);
    } catch (e) {
        return { ok: false, code: 'DEVICE_NOT_GRANTED', error: `The lease table cannot be read (${e.message}); ${label} stays closed`, device: dev, holder: null, hint: HINT };
    }
    // a lease from before consent existed: the first use turns it into an ask (it never runs unasked)
    if (h && (h.consent || 'none') === 'none') {
        try { h = dq.requireConsent(h.id) || h; changed(dev); } catch (_) { /* answered below as not granted */ }
    }
    if (h && h.consent === 'allowed' && (!h.ends_at || h.ends_at > Date.now())) {
        const lease = { id: h.id, device: dev, agentId: h.agent_id, why: h.why, startedAt: h.started_at, endsAt: h.ends_at, consent: 'allowed' };
        // an allowed lease is its holder's alone (#1305 S3): another agent's call, or one that cannot say who it is, is refused
        if (caller && caller.human === true) return { ok: true, lease, device: dev }; // Yukimi's own action in her UI, not an agent
        // a call site from before #1305 S3 passes no caller at all (undefined): it keeps the old rule until it passes one (the
        // device tools' deviceAdb.js / mcpAgentFacade.js patch); a caller object that names nobody is refused
        if (caller === undefined) return { ok: true, lease, device: dev, callerUnchecked: true };
        if (!caller || typeof caller !== 'object' || (!String(caller.agentId || '').trim() && !String(caller.sessionId || '').trim())) {
            return { ok: false, code: 'DEVICE_CALLER_UNKNOWN', error: `${label} is allowed to its holder only and this call does not say which agent makes it (the gate fails closed): pass your agent id`, device: dev, holder: holderOf(h), hint: 'Call the device tool with your agent id (coord_hello shows it).' };
        }
        if (!holderIs(h, caller)) {
            return { ok: false, code: 'DEVICE_NOT_GRANTED', error: `${label} is allowed to ${holderOf(h).name}, not to you: request it with coord_device_request and wait for your own Allow`, device: dev, holder: holderOf(h), hint: HINT };
        }
        return { ok: true, lease, device: dev };
    }
    if (h && h.consent === 'pending') {
        return { ok: false, code: 'DEVICE_PENDING', error: `${label} waits for Yukimi to tap Allow on the phone`, device: dev, holder: holderOf(h), hint: HINT };
    }
    if (offLimits) return { ok: false, code: 'DEVICE_OFF_LIMITS', error: dq.OFF_LIMITS_MSG, device: dev, holder: holderOf(h), hint: 'Use the A53 (your test phone) or the emulator lane; the Fold only with coord_device_request fold purpose final-install, or after Yukimi approved.' };
    if (denied) {
        return { ok: false, code: 'DEVICE_DENIED', error: `Yukimi denied the last request for ${label}`, device: dev, holder: holderOf(denied), hint: HINT };
    }
    return { ok: false, code: 'DEVICE_NOT_GRANTED', error: `${label} is not granted to anyone: shared phones need coord_device_request and Yukimi's Allow`, device: dev, holder: holderOf(h), hint: HINT };
}

/** Test hook: replaces the notices module. */
function _setNotices(mod) { noticesOverride = mod; }
/** Test hook: clears every timer and the sync memory. */
function _reset() {
    [...askTimers.keys()].forEach(clearAskTimer);
    quiet.clear();
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    lastSig = '';
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; pendingAt = 0; }
    lastPendingSweepAt = 0;
}
/** Test hook: how long a pending ask may sit before the sweep timer looks at it (default 10 min). */
function _setPendingSweepMs(ms) { pendingSweepMs = Number(ms) > 0 ? Number(ms) : PENDING_SWEEP_MS; }

module.exports = { settings, setSettings, changed, resync, start, answer, endHold, askLane, laneOfDevice, check, deviceFor, isReadOnlyShell, isEmulatorTarget, DEFAULTS, TARGET_MATCHERS, PENDING_SWEEP_MS, _setNotices, _reset, _setPendingSweepMs };
