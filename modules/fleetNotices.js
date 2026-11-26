'use strict';

/**
 * Fleet notices (Yozora #1196): the one place Fleet puts anything on Yukimi's phone.
 *
 * Her phone gets exactly two kinds of Fleet notice:
 *   1. a work item she started is DONE                      (switch workDone,      id fleet-work:<id>:done)
 *   2. a work item NEEDS HER: Input Required, or it failed   (switch workAttention, id fleet-work:<id>:attention)
 * A third, rare one: a Claude account's login expired and needs signing in again (switch accountLogin, on unless the
 * Supervisor's notify settings say false; id fleet-account:<id>:login, comes down when the account works again).
 * Everything routine (the maintenance report, usage flags, anything a producer adds later) tells the Supervisor first (a
 * note in the Manager Session's agent-coord inbox) and reaches the phone only when she switched that kind on in Fleet
 * Manager. Default is no notification: a kind agentSupervisor.NOTIFY_DEFAULTS does not list never publishes.
 *
 * Event driven only: agentSupervisor.setWork calls workChanged on a state change; the maintenance run and the usage audit
 * call routine when they have something to say. No timer, no polling.
 *
 * Phone side (existing mappings, nothing new): cls 'notification' ("Other notifications": wmShell SND_EVENTS) and
 * data.app 'claudedesk', which wmNotificationInbox.openFor opens through wmShell.open('claudedesk') on a tap.
 */

const realInbox = require('./notificationInbox');
// A test run (a temp agent-coord DB) never reaches the household's real inbox unless it set its own inbox DB too: a test
// once published 13 fixture notices to the phones (#1196). Sandboxed, every inbox call is a no-op.
const SANDBOXED = !!process.env.AGENT_COORD_DB && !process.env.NOTIFICATION_INBOX_DB;
const inbox = SANDBOXED
    ? { publish: () => null, clear: () => false, bind: () => null, list: () => [] }
    : realInbox;

const USER = 'admin';
const APP = 'claudedesk';
const CLS = 'notification';
const DAY = 24 * 60 * 60 * 1000;
const sup = () => require('./agentSupervisor');

const clip = (s, n) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
const doneId = (id) => `fleet-work:${id}:done`;
const acctId = (a) => `fleet-account:${a.id || `i${a.index}`}:login`;
const attnId = (id) => `fleet-work:${id}:attention`;

// accountLogin is not in NOTIFY_DEFAULTS (agentSupervisor's list is held elsewhere, and its cleaner drops unknown keys): the raw
// config's agentSupervisor.notify.accountLogin decides; a missing key means on, only an explicit false turns it off.
let boundGr = null;
function accountLoginOn(gr) {
    try {
        const g = gr || boundGr;
        const n = g && g.getConfig && g.getConfig().agentSupervisor && g.getConfig().agentSupervisor.notify;
        return !(n && n.accountLogin === false);
    } catch (_) { return true; }
}

// the data.kind of a routine notice already in the inbox -> the Fleet Manager switch that governs it
const ROUTINE_KINDS = { maintenance: 'maintenance', 'usage-flag': 'usage' };

function clearNotice(id) {
    try { return inbox.clear(USER, id, 'server'); } catch (_) { return false; }
}
function on(kind, gr) {
    try { return sup().notifyOn(kind, gr) === true; } catch (_) { return false; }
}
function savedQuestions(row) {
    try { const q = row && row.input_questions ? JSON.parse(row.input_questions) : []; return Array.isArray(q) ? q.filter((x) => x && x.question) : []; } catch (_) { return []; }
}

/**
 * A work item changed state (agentSupervisor.setWork, after the UPDATE). row is the raw supervisor_work row now, prevState
 * the state it left, at the moment of the change (the event's identity: a repeat of the same event never sounds twice,
 * a later one under the same id does - the inbox's digest, #1194).
 * @returns {string} what was done: 'done' | 'attention' | 'cleared' | '' (nothing)
 */
function workChanged(row, prevState, at) {
    if (!row || !row.id || row.state === prevState) return '';
    const id = row.id;
    const state = String(row.state || '');
    const attn = state === 'input' || state === 'failed';
    let did = '';
    // leaving a state takes its notice down, whatever the switches say (the phone must not keep a stale "needs you")
    if ((prevState === 'input' || prevState === 'failed') && !attn) { clearNotice(attnId(id)); did = 'cleared'; }
    if (prevState === 'done' && state !== 'done') { clearNotice(doneId(id)); did = 'cleared'; }
    // only what she started: top level, not a Supervisor / agent follow-up; the parts of a planner or a group never notify (their parent's settle does)
    if (row.parent_id || (row.joined_into !== null && row.joined_into !== undefined) || row.source === 'agent') return did;
    const when = Number(at) || Date.now();
    const title = clip(row.title || `Work item ${id}`, 90);
    if (state === 'done') {
        if (!on('workDone')) return did;
        inbox.publish({
            user: USER, app: APP, id: doneId(id), cls: CLS, alert: true,
            digest: `done:${id}:${row.ended_at || when}`,
            title: `Fleet: ${title} is done`, text: clip(row.message, 300),
            data: { app: APP, kind: 'work-done', workId: id }, ttlMs: 2 * DAY
        });
        return 'done';
    }
    if (attn) {
        if (!on('workAttention')) return did;
        let text;
        if (state === 'failed') text = clip(row.message, 300);
        else {
            const qs = savedQuestions(row);
            // an AskUserQuestion is already a request form that notifies her (notificationInboxSources.onQuestion): no second notice
            if (qs.some((q) => q.ask)) return did;
            const open = qs.filter((q) => !String(q.answer || '').trim());
            text = clip((open.length ? open : qs).map((q) => q.question).join('; ') || row.message, 300);
        }
        inbox.publish({
            user: USER, app: APP, id: attnId(id), cls: CLS, alert: true,
            digest: `attn:${id}:${state}:${(state === 'failed' && row.ended_at) || when}`,
            title: state === 'failed' ? `Fleet: ${title} stopped` : `Fleet: ${title} needs you`, text,
            data: { app: APP, kind: 'work-attention', workId: id, state }, ttlMs: 2 * DAY
        });
        return 'attention';
    }
    return did;
}

/** An item ended without news (its issue was closed elsewhere): no notice, and a "needs you" it had comes down. */
function workEndedQuietly(id) { clearNotice(attnId(id)); }

/**
 * A routine alert (the maintenance report, a usage flag, ...): the Supervisor hears of it first, the phone only when the
 * switch for kind is on. notice is the inbox shape ({ id, title, text, data, ttlMs }); an unknown kind never publishes.
 * @returns {{ told: boolean, published: boolean }}
 */
function routine(kind, notice) {
    const n = notice || {};
    let told = false;
    try { told = sup().tellManager(`${n.title || 'Fleet'}${n.text ? `\n${n.text}` : ''}`) === true; } catch (e) { console.warn(`[fleet-notices] manager note: ${e.message}`); }
    // no Manager Session: the report is already kept where Fleet Manager shows it (maintenance runs, usage flags); one log line
    if (!told) console.log(`[fleet-notices] ${kind}: ${clip(n.title, 120)}`);
    let published = false;
    if (on(kind) && n.id && n.title) {
        published = !!inbox.publish(Object.assign({ user: USER, app: APP, cls: CLS }, n, { data: Object.assign({ app: APP }, n.data || {}) }));
    }
    return { told, published };
}

/**
 * Takes the phone notices down that a switch no longer allows: routine kinds already in the inbox (maintenance / usage
 * flags) and the work notices of a kind switched off. Runs at start and whenever the switches change.
 * @returns {number} how many were cleared
 */
function sweepRoutine(gr) {
    let n = 0;
    if (gr) boundGr = gr;
    try {
        inbox.bind(gr);
        inbox.list(USER).forEach((r) => {
            if (r.state !== 'new' && r.state !== 'seen') return;
            const d = r.data || {};
            if (r.app !== APP && d.app !== APP) return;
            let sw = ROUTINE_KINDS[d.kind];
            if (!sw && d.kind === 'work-done') sw = 'workDone';
            if (!sw && d.kind === 'work-attention') sw = 'workAttention';
            if (d.kind === 'account-login' && !accountLoginOn(gr)) { if (clearNotice(r.id)) n += 1; return; }
            if (sw && !on(sw, gr) && clearNotice(r.id)) n += 1;
        });
    } catch (e) { console.warn(`[fleet-notices] sweep: ${e.message}`); }
    return n;
}

/**
 * A Claude account entered the 'login' state (claudeFleetSettings.trackLogin, once per change): a loud notice that opens
 * Fleet on its Accounts page. acct = { index, id, name, since }.
 * @returns {boolean} published
 */
function accountLogin(acct, gr) {
    const a = acct || {};
    if (!accountLoginOn(gr)) return false;
    const name = clip(a.name || `Claude ${Number(a.index) + 1}`, 60);
    return !!inbox.publish({
        user: USER, app: APP, id: acctId(a), cls: CLS, alert: true,
        digest: `login:${a.id || a.index}:${a.since || 0}`,
        title: `Claude account ${name} needs signing in`,
        text: `Its login expired, so Fleet moves work to the other accounts until you sign in again: Fleet > Accounts > ${name} > Sign In Again.`,
        data: { app: APP, kind: 'account-login', accountIndex: a.index, page: 'accounts' }, ttlMs: 7 * DAY
    });
}
/** The account works again: its notice comes down. */
function accountLoginCleared(acct) { return clearNotice(acctId(acct || {})); }

module.exports = { accountLogin, accountLoginCleared, accountLoginOn, workChanged, workEndedQuietly, routine, sweepRoutine, ROUTINE_KINDS };
