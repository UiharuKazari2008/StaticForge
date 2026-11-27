'use strict';

/**
 * Device consent notices (Yozora #1284, P3): the on-screen Allow / Deny question and the "held" status of a shared phone,
 * put on the household's phones through the durable inbox (notificationInbox publish / clear, which the activeSync
 * `as_event inbox.notice` push and the phone's own notification carry).
 *
 *   ask   id device-ask:<leaseId>  loud once, buttons Allow / Deny (answerType device_consent_answer), life 12 h
 *   hold  id device-hold:<device>  silent, "<label> is in use by <agent>", life until endsAt + 5 min
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
const APP = 'claudedesk';
const CLS = 'fleet';
const HOUR = 60 * 60 * 1000;
const ASK_LIFE = 12 * HOUR;
const HOLD_GRACE = 5 * 60 * 1000;
const ASK_PREFIX = 'device-ask:';
const HOLD_PREFIX = 'device-hold:';

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

function clearNotice(id) {
    try { return inbox.clear(USER, id, 'server') === true; } catch (_) { return false; }
}

function publishAsk(a, quiet) {
    const leaseId = String(a.leaseId || '');
    if (!leaseId) return false;
    const who = clip(a.agentName || a.agentId || 'An agent', 60);
    const label = clip(a.label || a.device || 'device', 60);
    const minutes = Math.max(1, Math.round(Number(a.minutes) || 0));
    try {
        return !!inbox.publish({
            user: USER, app: APP, id: askId(leaseId), cls: CLS,
            alert: !quiet,
            digest: `ask:${leaseId}`,
            title: clip(`${who} wants the ${label}`, 120),
            text: clip(`Why: ${clip(a.why, 160) || 'not given'}. For up to ${minutes} min. Allow it?`, 300),
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
        return !!inbox.publish({
            user: USER, app: APP, id: holdId(device), cls: CLS,
            alert: false,
            digest: `hold:${h.leaseId || ''}:${endsAt || 0}`,
            title: clip(`${label} is in use by ${who}`, 120),
            text: clip(`${clip(h.why, 160) || 'In use'}.${until}`, 300),
            data: { app: APP, kind: 'device-hold', device, leaseId: h.leaseId, page: 'devices' },
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
        const keep = new Set();
        for (const a of Array.isArray(snap.asks) ? snap.asks : []) {
            if (!a || !a.leaseId) continue;
            keep.add(askId(a.leaseId));
            if (publishAsk(a, quiet.has(a.leaseId))) out.published.push(askId(a.leaseId));
        }
        for (const h of Array.isArray(snap.holds) ? snap.holds : []) {
            if (!h || !h.device) continue;
            keep.add(holdId(h.device));
            if (publishHold(h, now)) out.published.push(holdId(h.device));
        }
        let held = [];
        try { held = inbox.list(USER) || []; } catch (_) { held = []; }
        for (const n of held) {
            const id = n && n.id ? String(n.id) : '';
            if (!id.startsWith(ASK_PREFIX) && !id.startsWith(HOLD_PREFIX)) continue;
            if (n.state !== 'new' && n.state !== 'seen') continue;
            if (keep.has(id)) continue;
            if (clearNotice(id)) out.cleared.push(id);
        }
    } catch (_) { /* a notice is never worth a throw */ }
    return out;
}

/** An ask was answered (or lapsed): its notice comes down now. */
function clearAsk(leaseId) { return clearNotice(askId(leaseId)); }

module.exports = { sync, clearAsk, askId, holdId, ASK_PREFIX, HOLD_PREFIX, ASK_LIFE, HOLD_GRACE };
