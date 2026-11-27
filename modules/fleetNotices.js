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
 * Class and stacking (Yozora #1291): every Fleet notice is cls 'notification' (the sound of "Other notifications"; its icon and holder picture come from its id, status-order.js) and data.app
 * 'claudedesk', which wmNotificationInbox.openFor opens through wmShell.open('claudedesk') on a tap. The work notices STACK
 * (notificationInbox #1098): "is done" is the row stack:fleetdone, "needs you" / "stopped" the row stack:fleetattn - twenty
 * items finishing in a row are ONE notice with a count and ONE sound (the row new is loud, an item joining is silent), each item
 * keeping its own id (fleet-work:<id>:done / :attention), title, text and data.workId so a tap on it opens that work item. An
 * item leaves its stack when its notice comes down (a state change, an item ended quietly, a switch turned off, its life over).
 * The account login notice and the routine ones stay single rows.
 *
 * Body and key (Yukimi, Nov 27 2026: a Fleet notice reached her phone with an empty body and no key; the inbox refuses one like it, notificationInbox
 * noticeGap): every Fleet notice has a one-line body (done: the item's own outcome line, never the title again; needs you: the first
 * open question; stopped: the reason; login: where to sign in; routine: the producer's text) and an Open key (actions [{ id: 'open' }]) that
 * opens its place - the work item (data.workId) or the page (data.page) - the way a tap on the notice does.
 *
 * Lives (#1291; "is done" for two days looked like never): done 4 h, needs you / stopped 12 h, account login 24 h, routine
 * (maintenance, usage) 4 h. Each stack item has its own expiry; notificationInbox takes it out of the stack when it is over.
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
const CLS = 'notification'; // "Other notifications": the sound she chose for it (no sound event of Fleet's own, #1291)
const HOUR = 60 * 60 * 1000;
const LIFE = { done: 4 * HOUR, attention: 12 * HOUR, login: 24 * HOUR, routine: 4 * HOUR };
// the stack keys (notificationInbox STACK_TITLES / STACK_LINES)
const STACK_DONE = 'fleetdone';
const STACK_ATTN = 'fleetattn';
const sup = () => require('./agentSupervisor');

const clip = (s, n) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
// the call to action every Fleet notice carries (the inbox guard, Yukimi Nov 27 2026: no body or no call to action registers nothing):
// Open takes her to the thing - data.app 'claudedesk' + data.workId (a work item) or data.page (accounts / devices) - the way a tap on
// the notice does (wmNotificationInbox openFor -> wmShell.open('claude-accounts', { workId, page }))
const openKey = () => [{ id: 'open', label: 'Open' }];
/** One line of what landed or why it stopped: the item's own message (its outcome / last report line), clipped; '' when it only repeats the title or says nothing. */
function said(row, title) {
    const line = clip(row && row.message, 140);
    const low = line.toLowerCase();
    if (!line || low === 'done' || low === 'done.' || low === String(title || '').toLowerCase() || low.startsWith(`${String(title || '').toLowerCase()} is `)) return '';
    return line;
}
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
const ROUTINE_KINDS = { maintenance: 'maintenance', 'usage-flag': 'usage', 'app-update-waiting': 'appUpdate' };

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
    // short on purpose (Yukimi, Nov 26 2026: "EXTREMELY wordy" - a done notice says WHAT is done and nothing else; the item's report stays in Fleet)
    const title = clip(row.title || `Work item ${id}`, 70);
    if (state === 'done') {
        if (!on('workDone')) return did;
        inbox.publish({
            user: USER, app: APP, id: doneId(id), cls: CLS, alert: true,
            digest: `done:${id}:${row.ended_at || when}`,
            // the body says what landed (never the title again); the inbox guard refuses a notice with none
            title: `${title} is done`, text: said(row, title) || 'Finished. The report is in Fleet.', actions: openKey(),
            data: { app: APP, kind: 'work-done', workId: id }, stack: STACK_DONE, ttlMs: LIFE.done
        });
        return 'done';
    }
    if (attn) {
        if (!on('workAttention')) return did;
        // the body (the inbox guard refuses a notice with none): stopped - the reason in one line; needs you - the first question
        let text = '';
        if (state !== 'failed') {
            const qs = savedQuestions(row);
            // an AskUserQuestion is already a request form that notifies her (notificationInboxSources.onQuestion): no second notice
            if (qs.some((q) => q.ask)) return did;
            const open = qs.filter((q) => !String(q.answer || '').trim());
            text = clip(((open.length ? open : qs)[0] || {}).question || '', 140); // the first question only
        }
        text = text || said(row, title) || (state === 'failed' ? 'It stopped before it finished. The reason is in Fleet.' : 'It is waiting for your answer in Fleet.');
        inbox.publish({
            user: USER, app: APP, id: attnId(id), cls: CLS, alert: true,
            digest: `attn:${id}:${state}:${(state === 'failed' && row.ended_at) || when}`,
            title: state === 'failed' ? `${title} stopped` : `${title} needs you`, text, actions: openKey(),
            data: { app: APP, kind: 'work-attention', workId: id, state }, stack: STACK_ATTN, ttlMs: LIFE.attention
        });
        return 'attention';
    }
    return did;
}

/** An item ended without news (its issue was closed elsewhere): no notice, and a "needs you" or "is done" it had comes down (out of its stack). */
function workEndedQuietly(id) { clearNotice(attnId(id)); clearNotice(doneId(id)); }

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
        // a routine notice lives four hours whatever its producer asked for (a "needs a look" two days old is no news)
        const ttlMs = Number(n.ttlMs) > 0 ? Math.min(Number(n.ttlMs), LIFE.routine) : LIFE.routine;
        // a body and the Open key whatever the producer sent (the inbox guard refuses a notice with neither)
        const text = String(n.text == null ? '' : n.text).trim() ? n.text : 'The details are in Fleet.';
        const actions = Array.isArray(n.actions) && n.actions.length ? n.actions : openKey();
        published = !!inbox.publish(Object.assign({ user: USER, app: APP, cls: CLS }, n, { text, actions, data: Object.assign({ app: APP }, n.data || {}), ttlMs }));
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
        // the switch a Fleet notice (a row, or an item inside a stack row) answers to, or '' (not Fleet's / always allowed)
        const switchOf = (d) => {
            if (d.kind === 'work-done') return 'workDone';
            if (d.kind === 'work-attention') return 'workAttention';
            return ROUTINE_KINDS[d.kind] || '';
        };
        const off = (d) => {
            if (d.kind === 'account-login') return !accountLoginOn(gr);
            const sw = switchOf(d);
            return !!sw && !on(sw, gr);
        };
        inbox.list(USER).forEach((r) => {
            if (r.state !== 'new' && r.state !== 'seen') return;
            const d = r.data || {};
            // a stack row (stack:fleetdone / stack:fleetattn): its items are what a switch governs, one by one (the last one clears the row)
            if (String(r.id).startsWith('stack:') && Array.isArray(d.items)) {
                if (r.app !== APP) return;
                d.items.forEach((it) => { if (it && it.id && it.data && it.data.app === APP && off(it.data) && clearNotice(it.id)) n += 1; });
                return;
            }
            if (r.app !== APP && d.app !== APP) return;
            if (off(d) && clearNotice(r.id)) { n += 1; return; }
            // a notice from before the lives were set (Nov 26 2026, #1291: two days for "is done" looked like never; one row per
            // item, never stacked): it goes once its kind's life is over, counted from when it was raised
            const life = { 'work-done': LIFE.done, 'work-attention': LIFE.attention, 'account-login': LIFE.login, maintenance: LIFE.routine, 'usage-flag': LIFE.routine, 'app-update-waiting': LIFE.routine }[d.kind];
            const raised = Number(r.createdAt) || 0;
            if (life && raised && Date.now() - raised > life && Number(r.expiresAt) > raised + life && clearNotice(r.id)) n += 1;
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
        text: 'Sign in again: Fleet > Accounts.', actions: openKey(),
        data: { app: APP, kind: 'account-login', accountIndex: a.index, page: 'accounts' }, ttlMs: LIFE.login
    });
}
/** The account works again: its notice comes down. */
function accountLoginCleared(acct) { return clearNotice(acctId(acct || {})); }

module.exports = { accountLogin, accountLoginCleared, accountLoginOn, workChanged, workEndedQuietly, routine, sweepRoutine, ROUTINE_KINDS };
