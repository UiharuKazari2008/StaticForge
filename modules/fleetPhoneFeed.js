'use strict';

// The phone Fleet app's Work Queue snapshot (#1198): statusHub feed `claude_fleet_phone`, defined in
// modules/ws/handlers/314-claudeDeskHandler.js. One object, each top-level key diffed by statusHub.
// Local reads only (the Supervisor's tables, live sessions, one stat per idle live session); no network.
// Every source is wrapped, so one failing source leaves its key empty and never breaks the snapshot.

const fs = require('fs');

const HOUR = 3600000;
const OPEN = new Set(['held', 'queued', 'starting', 'running', 'waiting', 'input']);
const lazy = (name) => { try { return require(name); } catch (_) { return null; } };
const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function accountNames(gr) {
    const map = new Map();
    if (!gr) return map;
    try { (lazy('./claudeAccountHost').listAccounts(gr) || []).forEach((a) => { map.set(String(a.index), a.name); if (a.name) map.set(String(a.name), a.name); }); } catch (_) { /* none */ }
    return map;
}
const accountOf = (names, raw) => (raw === undefined || raw === null || raw === '' ? '' : (names.get(String(raw)) || (/^\d+$/.test(String(raw)) ? '' : String(raw))));

function shortIssue(w) {
    if (!w.issue) return { issue: '', issueUrl: '' };
    const extra = Array.isArray(w.issues) && w.issues.length > 1 ? ` +${w.issues.length - 1}` : '';
    return { issue: `${String(w.issue.repo || '').split('/').pop()}#${w.issue.number}${extra}`, issueUrl: w.issue.url || '' };
}

/** { doing, tasks } of a session from its task list (modules/sessionTasks.js). */
function tasksOf(T, sid) {
    const none = { doing: '', tasks: null };
    if (!T || !sid) return none;
    try {
        const l = T.list(sid);
        const open = (l.tasks || []).find((t) => !t.done);
        const c = l.counts || {};
        return { doing: open ? cut(open.text, 120) : '', tasks: c.tasksTotal ? { done: c.tasksDone || 0, total: c.tasksTotal } : null };
    } catch (_) { return none; }
}

function buildWork(sup, T, liveById, holds, names) {
    let rows = [];
    try { rows = sup.listWork({ limit: 150 }); } catch (_) { return []; }
    const kids = new Map();
    rows.forEach((w) => { if (w.parentId) { const k = kids.get(w.parentId) || { total: 0, done: 0 }; k.total += 1; if (w.state === 'done') k.done += 1; kids.set(w.parentId, k); } });
    const since = Date.now() - 24 * HOUR;
    const open = rows.filter((w) => OPEN.has(w.state));
    const ended = rows.filter((w) => !OPEN.has(w.state) && (w.endedAt || w.createdAt || 0) >= since).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 10);
    return open.concat(ended).map((w) => {
        const sid = w.sessionId || '';
        const live = sid ? liveById.get(sid) : null;
        const h = sid ? holds.get(sid) : null;
        const t = OPEN.has(w.state) ? tasksOf(T, sid) : { doing: '', tasks: null };
        return Object.assign({
            id: w.id, title: cut(w.title, 160), state: w.state, source: w.source || '', account: accountOf(names, w.account),
            model: w.model || '', effort: w.effort || '', sessionId: sid,
            createdAt: w.createdAt || null, startedAt: w.startedAt || null, endedAt: w.endedAt || null,
            message: cut(w.message, 200), parentId: w.parentId || null, topology: w.topology || '',
            parts: kids.get(w.id) || null,
            sentBackAt: w.sentBackAt || null, sessionGone: !!w.sessionGone, parked: !!w.parked, parkedAt: w.parkedAt || null
        }, w.engine && w.engine !== 'claude' ? { engine: w.engine } : {}, shortIssue(w), {
            questions: w.state === 'input' ? (w.questions || []).slice(0, 12).map((q) => ({ question: cut(q.question, 400), answer: cut(q.answer, 400), why: cut(q.why, 300), ask: cut(q.ask, 400) })) : [],
            held: h ? { mode: h.mode, reason: cut(h.reason, 200) } : null,
            busy: !!(live && live.status === 'busy'), doing: t.doing, tasks: t.tasks
        });
    });
}

/** Live sessions no open work item owns, working or active in the last hour. */
function buildUnsupervised(live, owned, holds, T, names, coordAccounts) {
    const now = Date.now();
    const sessions = require('./claudeSessions');
    const out = [];
    live.forEach((s) => {
        if (owned.has(s.id)) return;
        let active = s.status === 'busy' || (s.startedAt && now - s.startedAt < HOUR);
        if (!active) {
            try { const f = sessions._findTranscript(s.id); active = !!(f && now - fs.statSync(f.file).mtimeMs < HOUR); } catch (_) { active = false; }
        }
        if (!active) return;
        const h = holds.get(s.id);
        const t = tasksOf(T, s.id);
        out.push({
            id: s.id, title: cut(s.title || s.name, 160), status: s.status || '',
            folder: String(s.cwd || '').split('/').filter(Boolean).pop() || '', startedAt: s.startedAt || null,
            account: accountOf(names, coordAccounts.get(s.id)),
            held: h ? { mode: h.mode, reason: cut(h.reason, 200) } : null, doing: t.doing, tasks: t.tasks
        });
    });
    return out.sort((a, b) => (a.status === 'busy' ? 0 : 1) - (b.status === 'busy' ? 0 : 1) || (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 30);
}

function callWindows(coord) {
    const now = Date.now();
    const w = { today: now - (now % 86400000), week: now - 7 * 86400000, month: now - 30 * 86400000 };
    const out = { today: { calls: 0, cost: 0 }, week: { calls: 0, cost: 0 }, month: { calls: 0, cost: 0 } };
    try {
        const st = coord.open().prepare('SELECT COUNT(*) calls, COALESCE(SUM(cost), 0) cost FROM supervisor_usage WHERE at >= ?');
        Object.keys(w).forEach((k) => { const r = st.get(w[k]); out[k] = { calls: r.calls || 0, cost: Math.round((r.cost || 0) * 10000) / 10000 }; });
    } catch (_) { /* no table yet */ }
    return out;
}

/** snapshot(gr, { live }): the feed's whole object. `live` = the handler's liveSummary(). */
function snapshot(gr, deps) {
    const live = Array.isArray(deps && deps.live) ? deps.live : [];
    const sup = lazy('./agentSupervisor');
    const coord = lazy('./agentCoord/store');
    const audit = lazy('./claudeUsageAudit');
    const names = accountNames(gr);
    let T = null;
    try { T = sup.sessionTasks(); } catch (_) { T = null; }
    const holds = new Map();
    let holdList = [];
    try { holdList = sup.listHolds(); holdList.forEach((h) => { if (!holds.has(h.sessionId)) holds.set(h.sessionId, h); }); } catch (_) { /* none */ }
    const liveById = new Map(live.map((s) => [s.id, s]));
    const coordAccounts = new Map();
    try { coord.listAgents({ all: true }).forEach((a) => { if (a.sessionId && a.account && a.account !== 'host') coordAccounts.set(a.sessionId, a.account); }); } catch (_) { /* none */ }

    let work = [];
    try { work = buildWork(sup, T, liveById, holds, names); } catch (_) { work = []; }
    const owned = new Set(work.filter((w) => OPEN.has(w.state) && w.sessionId).map((w) => w.sessionId));
    let unsupervised = [];
    try { unsupervised = buildUnsupervised(live, owned, holds, T, names, coordAccounts); } catch (_) { unsupervised = []; }

    let gaps = 0;
    try { gaps = sup.summary().open || 0; } catch (_) { /* none */ }
    let flagSum = { open: 0, items: [] };
    try { flagSum = audit.summary(); } catch (_) { /* none */ }
    let restartWaits = 0;
    try { restartWaits = coord.open().prepare('SELECT COUNT(*) n FROM gate_asks').get().n; } catch (_) { /* none */ }
    const n = (...states) => work.filter((w) => states.includes(w.state)).length;
    const counts = {
        running: n('starting', 'running', 'waiting'), input: n('input'), held: n('held'), pending: n('queued'), sentBack: n('waiting'),
        live: live.length, busy: live.filter((s) => s.status === 'busy').length, gaps, flags: flagSum.open || 0, holds: holdList.length, restartWaits
    };
    const flags = (flagSum.items || []).slice(0, 8).map((f) => ({ id: f.id, title: cut(f.title, 120), reason: cut(f.reason, 200), text: cut(f.text, 240), sessionId: f.sessionId || '', at: f.at || null }));
    // which kinds of notice reach the phone (the Supervisor's settings().notify, a map of kind -> bool)
    let notify = {};
    try { const nn = sup.settings(gr).notify; if (nn && typeof nn === 'object') Object.keys(nn).forEach((k) => { notify[k] = nn[k] === true; }); } catch (_) { notify = {}; }
    return { work, unsupervised, counts, notify, calls: coord ? callWindows(coord) : { today: { calls: 0, cost: 0 }, week: { calls: 0, cost: 0 }, month: { calls: 0, cost: 0 } }, flags };
}

module.exports = { snapshot };
