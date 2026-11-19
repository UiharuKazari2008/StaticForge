/**
 * Ingest Controller expiry (Yukimi, Nov 19 2026; replaces Tsubame's inbox janitor cron). The `expiry` module
 * (modules/ingestModules.js) holds the rules; this file keeps the tags and runs the sweep.
 *
 *   tags     ingest_expiry (modules/ingestStore.js), one row per tracked Inbox message. New mail is tagged when
 *            it arrives (controller hooks: tagArrival); every sweep also backfills whatever is in the Inbox and
 *            recomputes the rule expiry from the current rules, so changing the rules re-tags everything.
 *            Routing rules can add their own expiry (action expire { after, afterRead }): kept as route_*.
 *   clock    after:     arrived + afterMs          (arrived = the message's date; Exchange: delivery time)
 *            afterRead: first_read_at + afterReadMs (first_read_at = the first sweep / arrival that saw it read)
 *   flagged  never expires; checked from the synced copy every sweep and, for e-mail, refreshed from the mail
 *            server right before the move (so flagging it later always rescues it).
 *   sweep    every SWEEP_EVERY_MS for accounts in process mode with the module on, plus on demand
 *            (ingest_expiry_sweep) and soon after the module is switched on (backfill). Due mail goes to Trash
 *            (IMAP: the account's \Trash folder, e.g. iCloud "Deleted Messages"; Exchange: Deleted). Accounts in
 *            dry-run (applying off) only log "would expire" to ingest_log (once a day per message). Never a
 *            permanent delete: no Trash folder = nothing is moved.
 * Only the Inbox is swept: mail filed elsewhere (by Yukimi or a rule) is no longer tracked (state gone).
 */
'use strict';

const { redactCodes } = require('./ingestCodeRedact');

const SWEEP_EVERY_MS = 20 * 60 * 1000;
const FIRST_SWEEP_MS = 3 * 60 * 1000;
const DRY_RELOG_MS = 24 * 60 * 60 * 1000;
const KEEP_DONE_MS = 30 * 24 * 60 * 60 * 1000;
const MOVE_BATCH = 50;
const DEFAULT_MAX = 200;

let ctx = null; // { be, st, accountRow, effectivePipeline, log }
function bind(c) { ctx = c; }
let clock = null; // tests: a fake clock
const now = () => (clock ? clock() : Date.now());
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
function fail(code, message) { return Object.assign(new Error(message), { code }); }

/** The account's expiry module entry when it is in process mode with the module on, else null. */
function moduleOf(row) {
    if (!row || row.mode !== 'process') return null;
    const e = ctx.effectivePipeline(row).find((x) => x.id === 'expiry');
    return e && e.enabled ? e : null;
}

function emailKey(validity, r, dupIds) {
    const mid = String(r.msgid || '').trim();
    if (mid && !(dupIds && dupIds.has(mid))) return `m:${mid.slice(0, 300)}`;
    return `u:${validity || ''}:${r.uid}`;
}

/** due time of a row: the earlier of the after-arrival and the after-read clocks (null = waiting to be read). */
function dueOf(t) {
    const exp = [t.expiresAt, t.routeExpiresAt].filter((x) => x != null);
    const ar = [t.afterReadMs, t.routeAfterReadMs].filter((x) => x != null);
    const cands = [];
    if (exp.length) cands.push(Math.min(...exp));
    if (ar.length && t.firstReadAt != null) cands.push(t.firstReadAt + Math.min(...ar));
    return cands.length ? Math.min(...cands) : null;
}

function reasonOf(t) {
    const out = [];
    const exp = [t.expiresAt, t.routeExpiresAt].filter((x) => x != null);
    if (exp.length && Math.min(...exp) === t.dueAt) out.push('after arrival');
    if (t.firstReadAt != null && t.dueAt != null && !out.length) out.push('after read');
    return out.join(', ') || null;
}

/**
 * Merge what one sighting of a message says into its tag. m = { key, folder, uid, messageId, ref, sender, subject,
 * date, seen, flagged }; rule = expiryFor() result or null; route = { afterMs, afterReadMs, rule } or null.
 * -> the new tag (not written), or null when nothing tracks it.
 */
function merge(prev, m, rule, route, t0) {
    const arrived = prev && prev.arrived ? prev.arrived : Math.min(Number(m.date) || t0, t0);
    const t = Object.assign({}, prev || {}, {
        source: m.source, account: m.account, key: m.key, folder: m.folder, uid: m.uid != null ? m.uid : null, messageId: m.messageId || null, ref: m.ref || null,
        sender: redactCodes(clip(m.sender, 200)), subject: redactCodes(clip(m.subject, 200)), arrived, lastSeen: t0, flagged: !!m.flagged, error: null
    });
    t.expiresAt = rule && rule.afterMs ? arrived + rule.afterMs : null;
    t.afterReadMs = rule && rule.afterReadMs ? rule.afterReadMs : null;
    t.rule = rule ? rule.rules.join(',') : null;
    if (route) {
        if (route.afterMs) t.routeExpiresAt = t.routeExpiresAt != null ? Math.min(t.routeExpiresAt, arrived + route.afterMs) : arrived + route.afterMs;
        if (route.afterReadMs) t.routeAfterReadMs = t.routeAfterReadMs != null ? Math.min(t.routeAfterReadMs, route.afterReadMs) : route.afterReadMs;
        if (route.rule) t.routeRule = clip(route.rule, 60);
    }
    if (t.expiresAt == null && t.afterReadMs == null && t.routeExpiresAt == null && t.routeAfterReadMs == null) return null;
    if (m.seen && t.firstReadAt == null) t.firstReadAt = t0;
    t.dueAt = dueOf(t);
    if (['expired', 'gone'].includes(t.state)) t.dryLoggedAt = null; // back in the Inbox: a fresh life
    t.state = t.flagged ? 'flagged' : (t.dueAt != null && t.dueAt <= t0 ? 'due' : 'tagged');
    return t;
}

const MATERIAL = ['folder', 'uid', 'messageId', 'subject', 'sender', 'arrived', 'expiresAt', 'afterReadMs', 'rule', 'routeExpiresAt', 'routeAfterReadMs', 'routeRule', 'firstReadAt', 'flagged', 'dueAt', 'state', 'error'];
function changed(prev, t) { return !prev || MATERIAL.some((k) => (prev[k] == null ? null : prev[k]) !== (t[k] == null ? null : t[k])); }

// ---------------------------------------------------------------- arrival (controller hooks)

/** Tag one newly arrived message (msg as the controller normalizes it; Exchange after insert: msg.id). */
function tagArrival(msg, row, res) {
    try {
        const entry = moduleOf(row);
        const routeActs = (res && res.actions ? res.actions : []).filter((a) => a.type === 'expire');
        if (!entry && !routeActs.length) return null;
        if (res && res.stoppedBy) return null; // moved / deleted by the pipeline: not in the Inbox
        const M = require('./ingestModules');
        const rule = entry ? M.expiryFor(msg, entry.settings.rules) : null;
        const route = routeActs.length ? {
            afterMs: Math.min(...routeActs.map((a) => a.afterMs || Infinity)) === Infinity ? null : Math.min(...routeActs.map((a) => a.afterMs || Infinity)),
            afterReadMs: Math.min(...routeActs.map((a) => a.afterReadMs || Infinity)) === Infinity ? null : Math.min(...routeActs.map((a) => a.afterReadMs || Infinity)),
            rule: routeActs.map((a) => a.rule).filter(Boolean).join(',')
        } : null;
        let m;
        if (msg.source === 'email') {
            let validity = '';
            try { const f = ctx.be('mailStore').getFolder(msg.account, msg.folder || 'INBOX'); validity = f ? String(f.uidvalidity || '') : ''; } catch (_) { /* closed */ }
            const r = msg.row || {};
            const flags = parseFlags(r.flags);
            m = { source: 'email', account: msg.account, key: emailKey(validity, { msgid: msg.messageId, uid: msg.uid }), folder: msg.folder || 'INBOX', uid: msg.uid, messageId: msg.messageId,
                ref: `${msg.folder || 'INBOX'}:${msg.uid}`, sender: msg.from, subject: msg.subject, date: msg.date, seen: flags.includes('\\Seen'), flagged: flags.includes('\\Flagged') };
        } else if (msg.source === 'exchange') {
            if (!msg.id) return null;
            m = { source: 'exchange', account: msg.account, key: `x:${msg.id}`, folder: 'inbox', uid: null, messageId: msg.messageId || null, ref: msg.id,
                sender: msg.from, subject: msg.subject, date: msg.date, seen: !!msg.read, flagged: !!msg.flagged };
        } else return null;
        const s = ctx.st(true);
        const t = merge(s.getExpiry(m.source, m.account, m.key), m, rule, route, now());
        if (t) s.putExpiry(t);
        return t;
    } catch (e) { ctx.log(`expiry tag ${msg && msg.source}/${msg && msg.account}: ${e.message}`); return null; }
}

function parseFlags(f) {
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f || '[]'); } catch (_) { return []; }
}

// ---------------------------------------------------------------- reading the Inbox

/** Every Inbox message of an account: [{ key, folder, uid, messageId, ref, sender, subject, date, seen, flagged }]. */
function inboxOf(source, account) {
    if (source === 'email') {
        const ms = ctx.be('mailStore');
        const f = ms.getFolder(account, 'INBOX');
        if (!f) throw fail('NOT_SYNCED', 'The Inbox of that account is not synced yet.');
        const validity = String(f.uidvalidity || '');
        const rows = ms.listForExpiry(account, 'INBOX');
        const count = new Map();
        for (const r of rows) if (r.msgid) count.set(r.msgid, (count.get(r.msgid) || 0) + 1);
        const dup = new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
        return rows.map((r) => ({
            source, account, key: emailKey(validity, r, dup), folder: 'INBOX', uid: r.uid, messageId: r.msgid || null, ref: `INBOX:${r.uid}`,
            sender: r.sender || '', subject: r.subject || '', date: r.date, seen: r.seen === 1 || r.seen === true, flagged: r.flagged === 1 || r.flagged === true,
            match: { source, from: fromAddr(r), fromName: '', to: [], cc: [], subject: r.subject || '', text: '', headers: {} }
        }));
    }
    const dv = ctx.be('dovecote');
    const out = [];
    let cursor = null;
    for (let page = 0; page < 200; page++) {
        const list = dv.listMail(account, { folder: 'inbox', limit: dv.MAX_LIST || 200, cursor, silent: true });
        for (const x of list) {
            out.push({
                source, account, key: `x:${x.id}`, folder: 'inbox', uid: null, messageId: null, ref: x.id, sender: x.from || '', subject: x.subject || '',
                date: Date.parse(x.createdAt) || null, seen: !!x.read, flagged: !!x.flagged,
                match: { source, from: String(x.from || '').toLowerCase(), fromName: '', to: x.to || [], cc: x.cc || [], subject: x.subject || '', text: '', headers: {} }
            });
        }
        if (!list.hasMore || !list.nextCursor) break;
        cursor = list.nextCursor;
    }
    return out;
}

function fromAddr(r) {
    try {
        const env = typeof r.env === 'string' ? JSON.parse(r.env || '{}') : (r.env || {});
        const f = (env.from || [])[0];
        if (f && f.address) return String(f.address).toLowerCase();
    } catch (_) { /* fall back */ }
    const m = /<([^>]+)>/.exec(r.sender || '');
    return String(m ? m[1] : (r.sender || '')).toLowerCase();
}

// ---------------------------------------------------------------- moving to Trash

function trashOf(account) {
    try {
        const folders = ctx.be('mailAccounts').listFolders(account).folders || [];
        const t = folders.find((f) => f.special === '\\Trash') || folders.find((f) => /^(deleted messages|deleted items|trash)$/i.test(f.name || f.path || ''));
        return t ? t.path : null;
    } catch (_) { return null; }
}

/** Move due e-mail to Trash: flags re-read from the server first (a message flagged since the last sync stays). */
async function applyEmail(account, due, results) {
    const ma = ctx.be('mailAccounts');
    const ms = ctx.be('mailStore');
    const trash = trashOf(account);
    if (!trash) { for (const t of due) results.push({ t, ok: false, error: 'no Trash folder: nothing moved' }); return; }
    for (let i = 0; i < due.length; i += MOVE_BATCH) {
        const batch = due.slice(i, i + MOVE_BATCH);
        const uids = batch.map((t) => t.uid);
        try { await ma.setFlags(account, 'INBOX', uids, {}); } catch (e) { for (const t of batch) results.push({ t, ok: false, error: `flag check failed: ${clip(e.message, 120)}` }); continue; }
        const go = [];
        for (const t of batch) {
            const r = ms.getMessage(account, 'INBOX', t.uid);
            if (!r) { results.push({ t, ok: false, gone: true, error: 'no longer in the Inbox' }); continue; }
            if (t.messageId && r.msgid && r.msgid !== t.messageId) { results.push({ t, ok: false, error: 'UID now holds another message' }); continue; }
            const flags = parseFlags(r.flags);
            if (r.flagged === 1 || flags.includes('\\Flagged')) { results.push({ t, ok: false, flagged: true }); continue; }
            go.push(t);
        }
        if (!go.length) continue;
        try {
            await ma.move(account, 'INBOX', go.map((t) => t.uid), trash);
            for (const t of go) results.push({ t, ok: true, to: trash });
        } catch (e) { for (const t of go) results.push({ t, ok: false, error: clip(e.message, 160) }); }
    }
}

async function applyExchange(account, due, results) {
    const dv = ctx.be('dovecote');
    const go = [];
    for (const t of due) {
        const r = dv.getMessageRow(account, t.ref);
        if (!r || r.folder !== 'inbox') { results.push({ t, ok: false, gone: true, error: 'no longer in the Inbox' }); continue; }
        if (r.flagged) { results.push({ t, ok: false, flagged: true }); continue; }
        go.push(t);
    }
    for (let i = 0; i < go.length; i += MOVE_BATCH) {
        const batch = go.slice(i, i + MOVE_BATCH);
        try {
            const res = dv.markMailBatch(account, { ids: batch.map((t) => t.ref), deleted: true });
            const missing = new Set((res && res.missing) || []);
            for (const t of batch) results.push(missing.has(t.ref) ? { t, ok: false, gone: true, error: 'not found' } : { t, ok: true, to: 'deleted' });
        } catch (e) { for (const t of batch) results.push({ t, ok: false, error: clip(e.message, 160) }); }
    }
}

// ---------------------------------------------------------------- the sweep

const running = new Map();
const lastSweep = new Map(); // `${source}|${account}` -> summary

function publicTag(t, t0) {
    return {
        ref: t.ref, key: t.key, from: t.sender, subject: t.subject, arrived: iso(t.arrived), firstReadAt: iso(t.firstReadAt),
        expiresAt: iso(t.dueAt), dueInHours: t.dueAt != null ? Math.round(((t.dueAt - t0) / 3600000) * 10) / 10 : null,
        waitingForRead: t.dueAt == null && (t.afterReadMs != null || t.routeAfterReadMs != null),
        reason: reasonOf(t), rule: [t.rule, t.routeRule].filter(Boolean).join(',') || null, state: t.state
    };
}
function iso(ms) { return ms != null && Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null; }

/**
 * One account. opts: { apply (true = move due mail; needs the account applying), reason }. Without apply: dry-run.
 * -> { source, accountId, dryRun, scanned, tracked, newlyTagged, firstRead, flagged, due, expired, failed, wouldExpire[], errors[] }
 */
async function sweepAccount(source, account, opts = {}) {
    const k = `${source}|${account}`;
    if (running.has(k)) return running.get(k);
    const p = (async () => {
        const row = ctx.accountRow(source, account);
        const entry = moduleOf(row);
        if (!entry) throw fail('NOT_ENABLED', 'The expiry module is not on for that account (it needs process mode and ingest_configure_module expiry enabled:true).');
        const wantApply = opts.apply === true;
        if (wantApply && !row.applying) throw fail('NOT_APPLYING', 'That account is in dry-run: switch applying on (ingest_set_mode applying:true confirm:true) before expiry moves mail.');
        const dry = !wantApply;
        const t0 = now();
        const s = ctx.st(true);
        const M = require('./ingestModules');
        const rules = entry.settings.rules;
        const max = Number(entry.settings.maxPerSweep) || DEFAULT_MAX;
        const known = s.expiryMap(source, account);
        const inbox = inboxOf(source, account);
        const seenKeys = new Set();
        const writes = [];
        const written = new Set();
        const due = [];
        const sum = { source, accountId: account, dryRun: dry, at: iso(t0), scanned: inbox.length, tracked: 0, newlyTagged: 0, firstRead: 0, flagged: 0, due: 0, expired: 0, failed: 0, wouldExpire: [], errors: [] };
        for (const m of inbox) {
            const prev = known.get(m.key) || null;
            seenKeys.add(m.key);
            const t = merge(prev, m, M.expiryFor(m.match, rules), null, t0);
            if (!t) {
                // no rule matches it any more (the rules changed): untracked
                if (prev && !['expired', 'gone'].includes(prev.state)) { writes.push(Object.assign({}, prev, { state: 'gone', lastSeen: t0 })); written.add(m.key); }
                continue;
            }
            if (!prev || ['expired', 'gone'].includes(prev.state)) sum.newlyTagged++;
            if (t.firstReadAt === t0 && (!prev || prev.firstReadAt == null)) sum.firstRead++;
            sum.tracked++;
            if (t.state === 'flagged') sum.flagged++;
            if (t.state === 'due') due.push(t);
            if (changed(prev, t)) writes.push(t); // a big Inbox: only what changed is written
            written.add(m.key);
        }
        // tracked but not in the Inbox any more: filed / deleted elsewhere
        for (const t of known.values()) {
            if (seenKeys.has(t.key) || written.has(t.key) || ['expired', 'gone'].includes(t.state)) continue;
            writes.push(Object.assign({}, t, { state: 'gone', lastSeen: t0 }));
        }
        s.putExpiryMany(writes);
        due.sort((a, b) => a.dueAt - b.dueAt);
        sum.due = due.length;
        if (dry) {
            for (const t of due) {
                if (sum.wouldExpire.length < 50) sum.wouldExpire.push(publicTag(t, t0));
                if (t.dryLoggedAt != null && t0 - t.dryLoggedAt < DRY_RELOG_MS) continue;
                s.addLog({ source, account, ref: t.ref, dry: true, sender: t.sender, subject: t.subject, actions: [{ module: 'expiry', type: 'expire', to: 'trash', rule: [t.rule, t.routeRule].filter(Boolean).join(','), reason: reasonOf(t) }] });
                s.putExpiry(Object.assign({}, t, { dryLoggedAt: t0 }));
            }
        } else if (due.length) {
            const results = [];
            const batch = due.slice(0, max);
            if (source === 'email') await applyEmail(account, batch, results);
            else await applyExchange(account, batch, results);
            const done = [];
            for (const r of results) {
                const t = Object.assign({}, r.t);
                if (r.ok) { t.state = 'expired'; t.doneAt = t0; sum.expired++; } else if (r.flagged) { t.state = 'flagged'; t.flagged = true; sum.flagged++; } else if (r.gone) { t.state = 'gone'; } else { t.state = 'error'; t.error = clip(r.error, 200); sum.failed++; if (sum.errors.length < 10) sum.errors.push(clip(r.error, 160)); }
                done.push(t);
                if (r.ok || (!r.flagged && !r.gone)) {
                    s.addLog({ source, account, ref: t.ref, dry: false, sender: t.sender, subject: t.subject,
                        actions: [{ module: 'expiry', type: 'expire', to: r.to || 'trash', rule: [t.rule, t.routeRule].filter(Boolean).join(','), reason: reasonOf(t) }, { applied: [r.ok ? 'expire:ok' : 'expire:failed'] }] });
                }
            }
            s.putExpiryMany(done);
            if (due.length > max) sum.deferred = due.length - max;
            if (sum.expired || sum.failed) ctx.log(`expiry ${source}/${account}: ${sum.expired} to Trash${sum.failed ? `, ${sum.failed} failed` : ''}${sum.deferred ? `, ${sum.deferred} next sweep` : ''}`);
        }
        lastSweep.set(k, Object.assign({}, sum, { wouldExpire: undefined, reason: opts.reason || 'manual' }));
        return sum;
    })().finally(() => running.delete(k));
    running.set(k, p);
    return p;
}

/** Every account in process mode with the module on. Fails per account, never as a whole. */
async function sweepAll(opts = {}) {
    const s = ctx.st(false);
    if (!s) return { accounts: [] };
    const out = [];
    for (const row of s.listAccounts()) {
        if (!['email', 'exchange'].includes(row.source) || !moduleOf(row)) continue;
        try {
            out.push(await sweepAccount(row.source, row.account, { apply: row.applying === true && opts.dryRun !== true, reason: opts.reason || 'periodic' }));
        } catch (e) {
            out.push({ source: row.source, accountId: row.account, error: clip(e.message, 160) });
            lastSweep.set(`${row.source}|${row.account}`, { source: row.source, accountId: row.account, at: iso(now()), error: clip(e.message, 160), reason: opts.reason || 'periodic' });
        }
    }
    try { s.pruneExpiry(KEEP_DONE_MS); } catch (_) { /* closed */ }
    return { accounts: out };
}

let timer = null;
let firstTimer = null;
/** The server's periodic sweep (mailAccounts.init starts it). Idempotent. */
function start() {
    if (timer) return false;
    firstTimer = setTimeout(() => { sweepAll({ reason: 'periodic' }).catch((e) => ctx.log(`expiry sweep: ${e.message}`)); }, FIRST_SWEEP_MS);
    timer = setInterval(() => { sweepAll({ reason: 'periodic' }).catch((e) => ctx.log(`expiry sweep: ${e.message}`)); }, SWEEP_EVERY_MS);
    if (firstTimer.unref) firstTimer.unref();
    if (timer.unref) timer.unref();
    return true;
}
function stop() { clearInterval(timer); clearTimeout(firstTimer); timer = null; firstTimer = null; }

/** Backfill soon after the module is switched on (always dry: it only tags and logs). */
function backfillSoon(source, account) {
    const t = setTimeout(() => {
        sweepAccount(source, account, { dryRun: true, reason: 'backfill' }).catch((e) => ctx.log(`expiry backfill ${source}/${account}: ${e.message}`));
    }, 1500);
    if (t.unref) t.unref();
}

function status(source, account, { limit = 25 } = {}) {
    const row = ctx.accountRow(source, account);
    const entry = row ? ctx.effectivePipeline(row).find((x) => x.id === 'expiry') : null;
    const s = ctx.st(false);
    const t0 = now();
    const counts = s ? s.expiryCounts(source, account) : {};
    const upcoming = s ? s.listExpiry(source, account, { states: ['due', 'tagged'], limit }).map((t) => publicTag(t, t0)) : [];
    const failed = s ? s.listExpiry(source, account, { states: ['error'], limit: 10 }).map((t) => Object.assign(publicTag(t, t0), { error: t.error })) : [];
    return {
        source, accountId: account, mode: row ? row.mode : 'bypass', applying: row ? row.applying : false,
        enabled: !!(entry && entry.enabled), sweeping: !!moduleOf(row), dryRun: !(row && row.applying),
        rules: entry ? entry.settings.rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, subjectRegex: r.subjectRegex || undefined, match: r.match || undefined, afterDays: r.afterMs ? r.afterMs / 86400000 : undefined, afterReadDays: r.afterReadMs ? r.afterReadMs / 86400000 : undefined })) : [],
        counts: { tagged: counts.tagged || 0, due: counts.due || 0, flagged: counts.flagged || 0, expired: counts.expired || 0, gone: counts.gone || 0, error: counts.error || 0 },
        sweepEveryMinutes: SWEEP_EVERY_MS / 60000, lastSweep: lastSweep.get(`${source}|${account}`) || null,
        upcoming, failed
    };
}

module.exports = { bind, start, stop, sweepAccount, sweepAll, backfillSoon, tagArrival, status, merge, dueOf, SWEEP_EVERY_MS, _test: { lastSweep, running, setNow: (fn) => { clock = typeof fn === 'function' ? fn : null; } } };
