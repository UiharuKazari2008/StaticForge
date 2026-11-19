/**
 * Mail rules for the IMAP e-mail accounts (modules/mailAccounts.js): simple server-side filters
 * Tsubame (mailroom) keeps for Yukimi's own inboxes through the Messaging Bridge MCP module
 * (modules/messagingBridgeMcp.js, scope sfapp_messaging_bridge).
 *
 *   rule  { id, accountId: '*'|<account id>, name, enabled, position,
 *           match:   { from?, to?, subject? }        case-insensitive "contains"; every one given must match
 *           actions: { markRead?, flag?, moveTo?, delete? }   moveTo and delete are exclusive }
 *
 * Stored in .cache/mailaccounts.db (table rules, modules/mailAccountsStore.js). They run in the
 * server on the Inbox of each account as mail is synced in: after the IDLE fetch of new mail and
 * after every sync worker pass that changed the Inbox (mailAccounts.js calls applyNew). Each
 * account keeps a watermark (state rulesUid / rulesUidValidity), so a rule only touches mail that
 * arrives after it exists; runRules() applies them to mail already there, on demand.
 * First matching rule wins (lowest position, then oldest). Delete goes into Trash (mailAccounts.remove).
 */
'use strict';

const { randomUUID } = require('crypto');
const store = require('./mailAccountsStore');

const MATCH_KEYS = ['from', 'to', 'subject'];
const MAX_RULES = 200;
const MAX_TEXT = 200;
const running = new Map(); // accountId -> promise

function fail(code, message) { return Object.assign(new Error(message), { code }); }
function log(m) { console.log(`[mailRules] ${m}`); }
let mailOverride = null;
function mail() { return mailOverride || require('./mailAccounts'); }

function parse(json, fallback) { try { return JSON.parse(json || ''); } catch (_) { return fallback; } }

function ruleOut(row) {
    return {
        id: row.id, accountId: row.account || '*', name: row.name || '', enabled: row.enabled !== 0,
        position: row.position || 0, match: parse(row.match, {}), actions: parse(row.actions, {}),
        created: row.created || null, updated: row.updated || null, hits: row.hits || 0, lastHit: row.last_hit || null
    };
}

function normalizeMatch(m) {
    const src = m && typeof m === 'object' ? m : {};
    const out = {};
    for (const k of MATCH_KEYS) {
        if (src[k] == null) continue;
        const v = String(src[k]).trim().slice(0, MAX_TEXT);
        if (v) out[k] = v;
    }
    if (!Object.keys(out).length) throw fail('NO_MATCH', 'A rule needs at least one of match.from, match.to, match.subject.');
    return out;
}

function normalizeActions(a) {
    const src = a && typeof a === 'object' ? a : {};
    const out = {};
    if (src.markRead === true) out.markRead = true;
    if (src.flag === true) out.flag = true;
    if (src.moveTo != null && String(src.moveTo).trim()) out.moveTo = String(src.moveTo).trim().slice(0, MAX_TEXT);
    if (src.delete === true) out.delete = true;
    if (out.moveTo && out.delete) throw fail('BAD_ACTIONS', 'Pick moveTo or delete, not both.');
    if (!Object.keys(out).length) throw fail('NO_ACTIONS', 'A rule needs an action: markRead, flag, moveTo or delete.');
    return out;
}

function listRules({ accountId = null } = {}) {
    const rules = store.listRules().map(ruleOut);
    return { rules: accountId ? rules.filter((r) => r.accountId === '*' || r.accountId === accountId) : rules };
}

/** Create (no id) or update (id) a rule. Starts the watermark of the accounts it covers. */
function saveRule(input) {
    const body = input && typeof input === 'object' ? input : {};
    const prev = body.id ? store.getRule(body.id) : null;
    if (body.id && !prev) throw fail('NOT_FOUND', 'No such rule.');
    if (!prev && store.listRules().length >= MAX_RULES) throw fail('TOO_MANY', `At most ${MAX_RULES} rules.`);
    const before = prev ? ruleOut(prev) : null;
    const accountId = String(body.accountId != null ? body.accountId : (before ? before.accountId : '*')).trim() || '*';
    if (accountId !== '*' && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(accountId)) throw fail('BAD_ACCOUNT', 'accountId is an account id or "*".');
    const rule = {
        id: prev ? prev.id : `rule-${randomUUID().slice(0, 8)}`,
        account: accountId,
        name: String(body.name != null ? body.name : (before ? before.name : '')).trim().slice(0, MAX_TEXT),
        enabled: body.enabled != null ? body.enabled !== false : (before ? before.enabled : true),
        position: body.position != null ? Number(body.position) || 0 : (before ? before.position : 0),
        match: body.match != null || !before ? normalizeMatch(body.match) : before.match,
        actions: body.actions != null || !before ? normalizeActions(body.actions) : before.actions,
        created: prev ? prev.created : Date.now(),
        hits: prev ? prev.hits : 0,
        lastHit: prev ? prev.last_hit : null
    };
    if (!rule.match || !rule.actions) throw fail('BAD_RULE', 'A new rule needs match and actions.');
    store.putRule(rule);
    for (const id of accountIds(accountId)) startWatermark(id);
    return { rule: ruleOut(store.getRule(rule.id)) };
}

function deleteRule(id) {
    const n = store.deleteRule(id);
    if (!n) throw fail('NOT_FOUND', 'No such rule.');
    return { ok: true, id };
}

function accountIds(accountId) {
    if (accountId && accountId !== '*') return [accountId];
    try { return (mail().listAccounts().accounts || []).map((a) => a.id); } catch (_) { return []; }
}

function addrText(list) {
    return (Array.isArray(list) ? list : []).map((x) => (x && typeof x === 'object' ? `${x.name || ''} ${x.address || ''}` : String(x || ''))).join(' ');
}

/** Does one message (a store row) match a rule's conditions? Pure. */
function matches(rule, row) {
    const m = rule.match || {};
    const env = typeof row.env === 'string' ? parse(row.env, {}) : (row.env || {});
    const has = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
    if (m.from && !has(`${row.sender || ''} ${addrText(env.from)}`, m.from)) return false;
    if (m.to && !has(`${row.recipients || ''} ${addrText(env.to)} ${addrText(env.cc)}`, m.to)) return false;
    if (m.subject && !has(row.subject, m.subject)) return false;
    return !!(m.from || m.to || m.subject);
}

function rulesFor(accountId) {
    return store.listRules().map(ruleOut).filter((r) => r.enabled && (r.accountId === '*' || r.accountId === accountId));
}

/** Which rule each row hits (first match wins): -> [{ rule, uids, rows }] */
function plan(accountId, rows, rules) {
    const byRule = new Map();
    for (const row of rows) {
        const rule = rules.find((r) => matches(r, row));
        if (!rule) continue;
        if (!byRule.has(rule.id)) byRule.set(rule.id, { rule, uids: [], rows: [] });
        const g = byRule.get(rule.id);
        g.uids.push(row.uid);
        g.rows.push({ uid: row.uid, subject: row.subject || '', sender: row.sender || '' });
    }
    return [...byRule.values()];
}

/** Carry out a plan on one folder through mailAccounts (the mail server first, then the copy). */
async function execute(accountId, folder, groups) {
    const out = [];
    for (const g of groups) {
        const a = g.rule.actions || {};
        const done = { ruleId: g.rule.id, name: g.rule.name, uids: g.uids.slice(), actions: [] };
        try {
            const add = [];
            if (a.markRead) add.push('\\Seen');
            if (a.flag) add.push('\\Flagged');
            if (add.length) { await mail().setFlags(accountId, folder, g.uids, { add }); done.actions.push(...add); }
            if (a.delete) { await mail().remove(accountId, folder, g.uids); done.actions.push('delete'); }
            else if (a.moveTo && a.moveTo !== folder) { await mail().move(accountId, folder, g.uids, a.moveTo); done.actions.push(`move:${a.moveTo}`); }
            try { store.countRuleHits(g.rule.id, g.uids.length); } catch (_) { /* store closed */ }
        } catch (error) {
            done.error = error.message;
            done.code = error.code || 'ERROR';
            log(`${accountId} rule ${g.rule.id}: ${error.message}`);
        }
        out.push(done);
    }
    return out;
}

function startWatermark(accountId) {
    try {
        if (store.getState(accountId, 'rulesUid') != null) return;
        const f = store.getFolder(accountId, 'INBOX');
        store.setState(accountId, 'rulesUid', store.maxUid(accountId, 'INBOX'));
        store.setState(accountId, 'rulesUidValidity', f ? f.uidvalidity || '' : '');
    } catch (_) { /* store not open */ }
}

/**
 * New Inbox mail since the watermark: apply the rules, move the watermark. Called by mailAccounts.js
 * after IDLE fetches and after a sync changed the Inbox. One pass per account at a time.
 */
function applyNew(accountId) {
    const id = String(accountId || '');
    if (running.has(id)) return running.get(id).then(() => applyNew(id));
    const p = (async () => {
        const folder = store.getFolder(id, 'INBOX');
        const validity = folder ? String(folder.uidvalidity || '') : '';
        const mark = store.getState(id, 'rulesUid');
        // no watermark yet, or the Inbox was rebuilt (UIDs renumbered): start from now
        if (mark == null || String(store.getState(id, 'rulesUidValidity') || '') !== validity) {
            store.setState(id, 'rulesUid', store.maxUid(id, 'INBOX'));
            store.setState(id, 'rulesUidValidity', validity);
            return { applied: [] };
        }
        const rows = store.messagesAfterUid(id, 'INBOX', Number(mark) || 0, 500);
        if (!rows.length) return { applied: [] };
        store.setState(id, 'rulesUid', rows[rows.length - 1].uid);
        const rules = rulesFor(id);
        if (!rules.length) return { applied: [] };
        const applied = await execute(id, 'INBOX', plan(id, rows, rules));
        if (applied.length) log(`${id}: ${applied.map((x) => `${x.ruleId} x${x.uids.length}${x.error ? ' (failed)' : ''}`).join(', ')}`);
        return { applied };
    })().finally(() => running.delete(id));
    running.set(id, p);
    return p;
}

/**
 * Run the rules over mail already in a folder (default INBOX), newest first, up to limit.
 * dryRun (default true) only reports what would happen.
 */
async function runRules({ accountId, folder = 'INBOX', limit = 500, ruleId = null, dryRun = true } = {}) {
    const id = String(accountId || '');
    if (!id) throw fail('NO_ACCOUNT', 'accountId is required.');
    let rules = rulesFor(id);
    if (ruleId) rules = rules.filter((r) => r.id === ruleId);
    if (!rules.length) return { dryRun, matched: 0, groups: [] };
    const rows = store.listMessages(id, String(folder || 'INBOX'), { limit: Math.max(1, Math.min(Number(limit) || 500, 2000)) });
    const groups = plan(id, rows, rules);
    const matched = groups.reduce((n, g) => n + g.uids.length, 0);
    if (dryRun) return { dryRun: true, matched, groups: groups.map((g) => ({ ruleId: g.rule.id, name: g.rule.name, actions: g.rule.actions, count: g.uids.length, messages: g.rows.slice(0, 50) })) };
    return { dryRun: false, matched, applied: await execute(id, String(folder || 'INBOX'), groups) };
}

module.exports = { listRules, saveRule, deleteRule, matches, plan, applyNew, runRules, rulesFor, _test: { normalizeMatch, normalizeActions, setMail: (m) => { mailOverride = m || null; } } };
