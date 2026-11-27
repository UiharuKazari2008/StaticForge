'use strict';

/**
 * Device consent notices (Yozora #1284, P3): the on-screen Allow / Deny question and the "held" status of a shared phone,
 * put on the household's phones through the durable inbox (notificationInbox publish / clear, which the activeSync
 * `as_event inbox.notice` push and the phone's own notification carry).
 *
 *   ask   id device-ask:<leaseId>  sounds once, buttons Allow / Deny (answerType device_consent_answer), life 12 h
 *   hold  id device-hold:<device>  silent, "<label> is in use by <agent>", life until endsAt + 5 min
 *
 * Sound (Yozora #1305, Yukimi Nov 26 2026: "the most annoying sound"): class 'notification', the sound she chose for
 * "Other notifications" - the same as every other Fleet notice (#1291). Never class 'fleet': a phone whose stored sound
 * table still has the old 'fleet' event (Alarm4.mp3) would keep playing it with the page killed. One sound per ask, and
 * not even that when the same agent asked for the same phone within ASK_RESOUND_MS, or any ask sounded within
 * ASK_GAP_MS (a burst of asks is one sound); the ask is still shown and answerable.
 *
 * Test lane (#1305): an ask / hold the snapshot marks lane 'test' (a lease on a test device) goes to the inbox's user 'test'
 * queue, which only test devices receive; every other one stays the household's (user 'admin'). The one-sound gate is shared,
 * and the clearing pass keeps one keep-set per queue, so an admin row and a test row never clear each other.
 *
 * sync(snapshot, settings, opts) is the whole interface: it publishes what the snapshot holds and clears every
 * device-ask: / device-hold: notice the snapshot no longer holds. Event driven (the caller syncs on a change); no timer here.
 * A repeat sync never sounds twice (the ask's digest is its lease); opts.quiet (a Set of leaseIds whose answer time passed)
 * publishes that ask again silent, still shown. The answer comes back through ws device_consent_answer
 * (modules/ws/handlers/296-deviceConsentHandler.js).
 */

const realInbox = require('./notificationInbox');
// A test run (a temp agent-coord DB) never reaches the household's real inbox unless it set its own inbox DB too
// (the same guard as fleetNotices): sandboxed, every inbox call is a no-op.
const SANDBOXED = !!process.env.AGENT_COORD_DB && !process.env.NOTIFICATION_INBOX_DB;
const inbox = SANDBOXED
    ? { publish: () => null, clear: () => false, bind: () => null, list: () => [] }
    : realInbox;

const USER = 'admin';
const TEST_USER = 'test'; // the test lane of the inbox (modules/testDevices.js): only test devices receive it
const LANES = [USER, TEST_USER];
/** The inbox queue a snapshot entry belongs to: lane 'test' (a lease on a test device) -> the test lane, everything else the household's */
const userOfLane = (x) => (x && x.lane === 'test' ? TEST_USER : USER);
const APP = 'claudedesk';
const CLS = 'notification'; // "Other notifications" (#1305): never 'fleet', whose old default was Alarm4.mp3
const HOUR = 60 * 60 * 1000;
const ASK_LIFE = 12 * HOUR;
const HOLD_GRACE = 5 * 60 * 1000;
const ASK_PREFIX = 'device-ask:';
const HOLD_PREFIX = 'device-hold:';
const ASK_RESOUND_MS = 15 * 60 * 1000;
const ASK_GAP_MS = 60 * 1000;
/** `${agent}|${device}` -> when its ask last sounded; and when any ask last sounded (this server process) */
const lastLoud = new Map();
let lastLoudAny = 0;
/** leaseIds already published once by this process (a re-publish is never a new sound) */
const seen = new Set();

/** Whether a NEW ask may sound now (and note it when it does). A lease seen before never sounds again. */
function askSounds(a, now) {
    const leaseId = String(a.leaseId);
    if (seen.has(leaseId)) return false;
    seen.add(leaseId);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    const key = `${a.agentId || a.agentName || ''}|${a.device || ''}`;
    const last = lastLoud.get(key) || 0;
    if (now - last < ASK_RESOUND_MS || now - lastLoudAny < ASK_GAP_MS) return false;
    lastLoud.set(key, now);
    if (lastLoud.size > 200) lastLoud.delete(lastLoud.keys().next().value);
    lastLoudAny = now;
    return true;
}

const clip = (s, n) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
const askId = (leaseId) => `${ASK_PREFIX}${leaseId}`;
const holdId = (device) => `${HOLD_PREFIX}${device}`;
const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function clearNotice(id, user) {
    try { return inbox.clear(user || USER, id, 'server') === true; } catch (_) { return false; }
}

function publishAsk(a, quiet, now) {
    const leaseId = String(a.leaseId || '');
    if (!leaseId) return false;
    const loud = askSounds(a, now) && !quiet;
    const who = clip(a.agentName || a.agentId || 'An agent', 60);
    const label = clip(a.label || a.device || 'device', 60);
    const minutes = Math.max(1, Math.round(Number(a.minutes) || 0));
    try {
        // notice: device-ask
        return !!inbox.publish({
            user: userOfLane(a), app: APP, id: askId(leaseId), cls: CLS,
            alert: loud,
            digest: `ask:${leaseId}`,
            title: clip(`${who} wants the ${label}`, 120),
            // the duration first, short; the Allow / Deny keys ask the question (#1305 P7)
            text: clip(`For up to ${minutes} min. Why: ${clip(a.why, 160) || 'not given'}.`, 300),
            actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
            data: {
                app: APP, kind: 'device-ask', leaseId, device: a.device,
                buttons: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
                answerType: 'device_consent_answer', page: 'devices'
            },
            ttlMs: ASK_LIFE
        });
    } catch (_) { return false; }
}

function publishHold(h, now) {
    const device = String(h.device || '');
    const endsAt = Number(h.endsAt);
    if (!device) return false;
    const expiresAt = (Number.isFinite(endsAt) && endsAt > 0 ? endsAt : now) + HOLD_GRACE;
    if (expiresAt <= now) return false;
    const who = clip(h.agentName || h.agentId || 'an agent', 60);
    const label = clip(h.label || device, 60);
    const until = Number.isFinite(endsAt) && endsAt > 0 ? ` Until ${hhmm(endsAt)}.` : '';
    try {
        // notice: device-hold
        return !!inbox.publish({
            user: userOfLane(h), app: APP, id: holdId(device), cls: CLS,
            alert: false,
            digest: `hold:${h.leaseId || ''}:${endsAt || 0}`,
            title: clip(`${label} is in use by ${who}`, 120),
            text: clip(`${clip(h.why, 160) || 'In use'}.${until}`, 300),
            // a call to action (Yukimi, Nov 26 2026: "your notification has no call to action"): End takes the phone back
            actions: [{ id: 'end', label: 'End' }],
            data: {
                app: APP, kind: 'device-hold', device, leaseId: h.leaseId, page: 'devices',
                buttons: [{ id: 'end', label: 'End' }], answerType: 'device_consent_answer'
            },
            expiresAt
        });
    } catch (_) { return false; }
}

/**
 * Make the phone's device notices match the snapshot.
 * @param {{asks?: object[], holds?: object[]}} snapshot
 * @param {object} [settings] the consent settings (unused today; kept so a caller passes what it has)
 * @param {{quiet?: Set<string>, now?: number}} [opts] quiet: leaseIds whose answer time passed (silent re-publish)
 * @returns {{published: string[], cleared: string[]}} the ids acted on (never throws)
 */
function sync(snapshot, settings, opts) {
    const out = { published: [], cleared: [] };
    try {
        const snap = snapshot || {};
        const o = opts || {};
        const now = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now();
        const quiet = o.quiet instanceof Set ? o.quiet : new Set(Array.isArray(o.quiet) ? o.quiet : []);
        // per queue: an admin row and a test-lane row never clear each other
        const keep = { [USER]: new Set(), [TEST_USER]: new Set() };
        for (const a of Array.isArray(snap.asks) ? snap.asks : []) {
            if (!a || !a.leaseId) continue;
            keep[userOfLane(a)].add(askId(a.leaseId));
            if (publishAsk(a, quiet.has(a.leaseId), now)) out.published.push(askId(a.leaseId));
        }
        for (const h of Array.isArray(snap.holds) ? snap.holds : []) {
            if (!h || !h.device) continue;
            keep[userOfLane(h)].add(holdId(h.device));
            if (publishHold(h, now)) out.published.push(holdId(h.device));
        }
        for (const user of LANES) {
            let held = [];
            try { held = inbox.list(user) || []; } catch (_) { held = []; }
            for (const n of held) {
                const id = n && n.id ? String(n.id) : '';
                if (!id.startsWith(ASK_PREFIX) && !id.startsWith(HOLD_PREFIX)) continue;
                if (n.state !== 'new' && n.state !== 'seen') continue;
                if (keep[user].has(id)) continue;
                if (clearNotice(id, user)) out.cleared.push(id);
            }
        }
    } catch (_) { /* a notice is never worth a throw */ }
    return out;
}

/** An ask was answered (or lapsed): its notice comes down now, on whichever lane it was on. */
function clearAsk(leaseId) {
    let cleared = false;
    for (const user of LANES) if (clearNotice(askId(leaseId), user)) cleared = true;
    return cleared;
}

/** Test hook: forget which asks sounded. */
function _reset() { lastLoud.clear(); seen.clear(); lastLoudAny = 0; }

module.exports = { sync, clearAsk, askId, holdId, ASK_PREFIX, HOLD_PREFIX, ASK_LIFE, HOLD_GRACE, ASK_RESOUND_MS, ASK_GAP_MS, _reset };
