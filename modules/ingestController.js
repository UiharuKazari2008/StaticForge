/**
 * Ingest Controller (Yukimi, Nov 19 2026; built by Menma): one pipeline between the places mail and
 * texts arrive and Yukimi's inboxes. Per account (each IMAP bridge mail account, each text account,
 * each DS Exchange / Dovecote mailbox) a mode:
 *
 *   bypass   as before: nothing here touches the message (the older mail rules still run for e-mail)
 *   process  the account's ordered pipeline of modules (modules/ingestModules.js) runs on every NEW message:
 *              spamFilter -> codeExtraction -> routing        (reorder / toggle per account)
 *
 * Switching an account to process starts DRY-RUN: the intended actions are only logged (ingest_log, never a
 * body or a code) until `applying` is switched on (confirm:true). Modules only decide; the actions are applied
 * after the whole pipeline; a move or delete stops the later modules. Fail open everywhere: a module that
 * throws, times out or cannot reach spamd leaves the message alone.
 *
 * Where it hooks in (new messages only):
 *   email     mailAccounts.js rulesSoon() after IDLE / sync -> onMailArrived(account): per-account UID marker
 *             (state ingestUid in mailaccounts.db); bypass accounts get the older rules exactly as before
 *   exchange  mailGateway.js deliver -> exchangeInbound(msg) BEFORE dovecoteMail.deliverInboundMail (folder / read /
 *             flag applied at insert, so a filtered message never raises a "new mail" notification), then
 *             after(result) for forward / hand-off / notify
 *   sms       textMessaging.js onProviderEvent -> textInbound(account, event) before the broadcast
 *
 * Verification codes are secrets: they reach Yukimi's devices through the notification inbox and nowhere else
 * (no log line, no audit, no MCP activity, no agent hand-off). Hand-offs to an agent are Dovecote system mail.
 * MCP tools: modules/ingestMcp.js (scope sfapp_messaging_bridge, via messagingBridgeMcp.js).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./ingestStore');
const M = require('./ingestModules');
const { redactCodes } = require('./ingestCodeRedact');

const SOURCES = Object.freeze(['email', 'sms', 'exchange']);
const HANDOFF_FROM = 'ingest-controller@dream.737.jp.net';
const HANDOFF_LABEL = 'Ingest Controller <ingest-controller@dream.737.jp.net>';
const TERMINAL = new Set(['move', 'delete']);
const ORDER = ['markRead', 'flag', 'silence', 'forward', 'handToAgent', 'notify', 'move', 'delete'];
const MODULE_TIMEOUT = { spamFilter: 7000, codeExtraction: 2000, routing: 3000 };

function fail(code, message) { return Object.assign(new Error(message), { code }); }
function log(m) { console.log(`[ingest] ${m}`); }
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// ---------------------------------------------------------------- backends (tests replace them)

let backends = null;
function be(name) {
    if (backends && backends[name]) return backends[name];
    switch (name) {
        case 'mailAccounts': return require('./mailAccounts');
        case 'mailStore': return require('./mailAccountsStore');
        case 'mailRules': return require('./mailAccountsRules');
        case 'textMessaging': return require('./textMessaging');
        case 'dovecote': return require('./dovecoteMail');
        case 'notifier': return require('./notificationInbox');
        case 'spamd': return require('./ingestSpamd');
        default: throw new Error(`no backend ${name}`);
    }
}

let opened = false;
function cacheDir() {
    // the server's cache dir; only when globalResources is already loaded (it always is in the server)
    try {
        const m = require.cache[require.resolve('./globalResources')];
        if (m && m.exports && typeof m.exports.getPath === 'function') return m.exports.getPath('cache');
    } catch (_) { /* fall back */ }
    return undefined;
}
/** The store. create:false (the hooks): null while no account was ever configured, so nothing is created. */
function st(create) {
    if (!opened) {
        const dir = cacheDir() || path.join(__dirname, '..', '.cache');
        if (create !== true && !fs.existsSync(path.join(dir, 'ingest.db'))) return null;
        store.open(dir);
        opened = true;
    }
    return store;
}
function accountRow(source, account) { const s = st(false); return s ? s.getAccount(source, account) : null; }

// ---------------------------------------------------------------- accounts and pipelines

function validSource(source) {
    const s = String(source || '').trim().toLowerCase();
    if (!SOURCES.includes(s)) throw fail('BAD_SOURCE', `source is one of ${SOURCES.join(', ')}`);
    return s;
}

/** Every account the controller can cover: [{ source, account, label }]. */
function availableAccounts(source = null) {
    const out = [];
    const want = source ? validSource(source) : null;
    if (!want || want === 'email') {
        try { for (const a of be('mailAccounts').listAccounts().accounts || []) out.push({ source: 'email', account: a.id, label: a.email || a.id }); } catch (_) { /* none */ }
    }
    if (!want || want === 'sms') {
        try { for (const a of be('textMessaging').listAccounts().accounts || []) out.push({ source: 'sms', account: a.id, label: a.label || a.identity || a.id }); } catch (_) { /* none */ }
    }
    if (!want || want === 'exchange') {
        try { for (const a of be('dovecote').listMailboxes() || []) out.push({ source: 'exchange', account: a.owner, label: `${a.owner}@dream.737.jp.net` }); } catch (_) { /* none */ }
    }
    return out;
}

function requireAccount(source, account) {
    const s = validSource(source);
    const id = String(account || '').trim();
    if (!id) throw fail('NO_ACCOUNT', 'accountId is required');
    const found = availableAccounts(s).find((a) => a.account === id);
    if (!found) throw fail('NOT_FOUND', `No ${s} account "${id}".`);
    return { source: s, account: id, label: found.label };
}

function defaultPipeline() {
    return [
        { id: 'spamFilter', enabled: false, settings: {} },
        { id: 'codeExtraction', enabled: false, settings: {} },
        { id: 'routing', enabled: true, settings: {} }
    ];
}

/** The stored pipeline made whole: registry order for anything new, defaults under the settings. */
function effectivePipeline(row) {
    const stored = row && Array.isArray(row.pipeline) && row.pipeline.length ? row.pipeline : defaultPipeline();
    const seen = new Set();
    const out = [];
    for (const e of stored) {
        const mod = M.BY_ID.get(e && e.id);
        if (!mod || seen.has(mod.id)) continue;
        seen.add(mod.id);
        out.push({ id: mod.id, enabled: e.enabled === true, settings: Object.assign({}, mod.defaults, e.settings || {}) });
    }
    for (const d of defaultPipeline()) {
        if (seen.has(d.id)) continue;
        const mod = M.BY_ID.get(d.id);
        out.push({ id: d.id, enabled: d.enabled, settings: Object.assign({}, mod.defaults) });
    }
    return out;
}

function accountView(source, account, label, row) {
    const pipeline = effectivePipeline(row);
    return {
        source, accountId: account, label: label || account,
        mode: row ? row.mode : 'bypass', applying: row ? row.applying : false,
        dryRun: !!row && row.mode === 'process' && !row.applying,
        pipeline: pipeline.map((e) => ({ id: e.id, enabled: e.enabled })),
        updated: row ? row.updated : null
    };
}

function listAccounts({ source = null } = {}) {
    const s0 = st(false);
    const rows = new Map((s0 ? s0.listAccounts() : []).map((r) => [`${r.source}|${r.account}`, r]));
    return { accounts: availableAccounts(source).map((a) => accountView(a.source, a.account, a.label, rows.get(`${a.source}|${a.account}`) || null)) };
}

function needConfirm(confirm, what) {
    if (confirm !== true) throw fail('CONFIRM_REQUIRED', `${what} needs confirm:true`);
}

function expand(source, accountId) {
    if (accountId === '*') {
        const list = availableAccounts(validSource(source));
        if (!list.length) throw fail('NOT_FOUND', `No ${source} accounts.`);
        return list;
    }
    const a = requireAccount(source, accountId);
    return [{ source: a.source, account: a.account, label: a.label }];
}

/** Mail marker bookkeeping when an e-mail account enters / leaves process mode. */
function markers(account, entering) {
    try {
        const ms = be('mailStore');
        const f = ms.getFolder(account, 'INBOX');
        const validity = f ? String(f.uidvalidity || '') : '';
        const max = ms.maxUid(account, 'INBOX');
        if (entering) { ms.setState(account, 'ingestUid', max); ms.setState(account, 'ingestUidValidity', validity); }
        ms.setState(account, 'rulesUid', max); // the older rules never replay what happened in between
        ms.setState(account, 'rulesUidValidity', validity);
    } catch (_) { /* store not open */ }
}

/**
 * mode 'process' | 'bypass'; applying true|false (process only). process and applying need confirm:true.
 * A switch to process starts dry-run.
 */
function setMode({ source, accountId, mode, applying, confirm, actor } = {}) {
    const m = String(mode || '').toLowerCase();
    if (!['process', 'bypass'].includes(m)) throw fail('BAD_MODE', 'mode is process or bypass');
    const targets = expand(source, accountId);
    const wantApply = applying === true;
    if (m === 'process') needConfirm(confirm, 'Switching to process mode');
    if (wantApply) {
        if (m !== 'process') throw fail('BAD_MODE', 'applying only makes sense in process mode');
        needConfirm(confirm, 'Enabling applying');
    }
    const out = [];
    for (const t of targets) {
        const prev = st(true).getAccount(t.source, t.account);
        const was = prev ? prev.mode : 'bypass';
        const row = st(true).putAccount({
            source: t.source, account: t.account, mode: m,
            applying: m === 'process' ? (applying != null ? wantApply : (was === 'process' ? prev.applying : false)) : false,
            pipeline: effectivePipeline(prev), updatedBy: actor || null
        });
        if (t.source === 'email' && was !== m) markers(t.account, m === 'process');
        log(`${t.source}/${t.account}: ${was} -> ${row.mode}${row.mode === 'process' ? (row.applying ? ' (applying)' : ' (dry-run)') : ''}`);
        out.push(accountView(t.source, t.account, t.label, row));
    }
    return targets.length === 1 && accountId !== '*' ? { account: out[0] } : { accounts: out };
}

function moduleView(mod, entry, source) {
    return { id: mod.id, label: mod.label, description: mod.description, sources: mod.sources, supported: mod.sources.includes(source), enabled: entry ? entry.enabled : false, settings: entry ? entry.settings : mod.defaults };
}

async function listModules({ source, accountId, probe } = {}) {
    const catalog = M.MODULES.map((m) => ({ id: m.id, label: m.label, description: m.description, sources: m.sources, defaults: m.defaults }));
    if (!source) return { modules: catalog };
    const a = requireAccount(source, accountId);
    const row = accountRow(a.source, a.account);
    const pipeline = effectivePipeline(row).map((e) => moduleView(M.BY_ID.get(e.id), e, a.source));
    const out = { account: accountView(a.source, a.account, a.label, row), pipeline, catalog: catalog.map((c) => c.id) };
    if (probe === true) {
        const spam = pipeline.find((p) => p.id === 'spamFilter');
        const s = (spam && spam.settings) || {};
        out.spamd = Object.assign({ host: s.host || null, port: s.port || null }, await be('spamd').ping(s.host, s.port, 3000));
    }
    return out;
}

/** enabled / settings / position for one module of one account (or '*': every account of the source). */
function configureModule({ source, accountId, module: moduleId, enabled, settings, position, reset, confirm, actor } = {}) {
    const mod = M.BY_ID.get(String(moduleId || ''));
    if (!mod) throw fail('NO_MODULE', `module is one of ${M.MODULES.map((m) => m.id).join(', ')}`);
    const targets = expand(source, accountId);
    const prepared = targets.map((t) => {
        const prev = st(true).getAccount(t.source, t.account);
        const pipe = effectivePipeline(prev);
        const idx = pipe.findIndex((e) => e.id === mod.id);
        const cur = pipe[idx];
        const before = cur.settings;
        let next = reset === true ? Object.assign({}, mod.defaults) : before;
        if (settings != null) {
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw fail('BAD_SETTINGS', 'settings is an object');
            next = Object.assign({}, next, settings);
        }
        const clean = Object.assign({}, mod.defaults, mod.validate(next, t.source));
        const nowEnabled = enabled != null ? enabled === true : cur.enabled;
        const wasRisky = !!(mod.isDestructive && mod.isDestructive(before)) && cur.enabled;
        const isRisky = !!(mod.isDestructive && mod.isDestructive(clean)) && nowEnabled;
        const live = !!prev && prev.mode === 'process' && prev.applying;
        const turningOn = nowEnabled && !cur.enabled;
        return { t, prev, pipe, idx, clean, nowEnabled, needs: (isRisky && !wasRisky) || (live && turningOn) || (isRisky && settings != null && live) };
    });
    if (prepared.some((p) => p.needs)) needConfirm(confirm, 'Enabling a module that deletes or forwards, or any module on an account that is applying');
    const out = [];
    for (const p of prepared) {
        const pipe = p.pipe.slice();
        const entry = { id: mod.id, enabled: p.nowEnabled, settings: p.clean };
        pipe.splice(p.idx, 1);
        const to = position != null ? Math.max(0, Math.min(Number(position) || 0, pipe.length)) : p.idx;
        pipe.splice(to, 0, entry);
        const row = st(true).putAccount({
            source: p.t.source, account: p.t.account, mode: p.prev ? p.prev.mode : 'bypass', applying: p.prev ? p.prev.applying : false,
            pipeline: pipe, updatedBy: actor || null
        });
        out.push({ account: accountView(p.t.source, p.t.account, p.t.label, row), module: moduleView(mod, entry, p.t.source), order: pipe.map((e) => e.id) });
    }
    return targets.length === 1 && accountId !== '*' ? out[0] : { accounts: out };
}

// ---------------------------------------------------------------- the pipeline

function withTimeout(promise, ms, what) {
    let t;
    return Promise.race([
        promise,
        new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), ms); if (t.unref) t.unref(); })
    ]).finally(() => clearTimeout(t));
}

function publicAction(a) {
    const o = {};
    for (const [k, v] of Object.entries(a)) {
        if (k.startsWith('_')) continue;
        o[k] = v;
    }
    if (a._text != null) o.text = '[redacted]';
    return o;
}

function normalizeActionList(list) {
    const out = [];
    for (const a of Array.isArray(list) ? list : []) {
        if (a && typeof a === 'object' && ORDER.includes(a.type)) out.push(a);
    }
    return out;
}

/**
 * Run the pipeline over one normalized message. Pure decision: returns { actions, trace, stoppedBy }.
 * pipelineOverride (dry-run tool) / depsOverride (tests) are optional.
 */
async function runPipeline(msg, { row = null, deps = null, forceAll = false } = {}) {
    const entries = effectivePipeline(row);
    const d = Object.assign({
        spamd: be('spamd'),
        legacyRules: (account) => be('mailRules').rulesFor(account),
        legacyMatches: (rule, r) => be('mailRules').matches(rule, r)
    }, deps || {});
    const trace = [];
    const merged = [];
    let stoppedBy = null;
    for (const e of entries) {
        const mod = M.BY_ID.get(e.id);
        const step = { module: e.id, enabled: e.enabled };
        if (!e.enabled && !forceAll) { step.ran = false; trace.push(step); continue; }
        if (!mod.sources.includes(msg.source)) { step.ran = false; step.note = { skipped: 'source not supported' }; trace.push(step); continue; }
        if (stoppedBy) { step.ran = false; step.note = { skipped: `stopped by ${stoppedBy}` }; trace.push(step); continue; }
        try {
            const res = await withTimeout(Promise.resolve(mod.run(msg, { settings: e.settings, account: msg.account, source: msg.source, deps: d })), MODULE_TIMEOUT[mod.id] || 3000, mod.id);
            const acts = normalizeActionList(res && res.actions);
            step.ran = true;
            step.actions = acts.map(publicAction);
            if (res && res.note) step.note = res.note;
            for (const a of acts) merged.push(Object.assign({ module: mod.id }, a));
            if (acts.some((a) => TERMINAL.has(a.type))) stoppedBy = mod.id;
        } catch (error) {
            step.ran = true;
            step.error = clip(error && error.message, 200);
            step.note = { failOpen: step.error };
        }
        trace.push(step);
    }
    // one terminal action (the first), the rest in a fixed order; identical actions once
    const seen = new Set();
    const firstTerminal = merged.find((a) => TERMINAL.has(a.type));
    const actions = merged
        .filter((a) => !TERMINAL.has(a.type) || a === firstTerminal)
        .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
        .filter((a) => { const k = `${a.type}|${a.to || a.mailbox || ''}|${a.kind || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { actions, trace, stoppedBy };
}

// ---------------------------------------------------------------- applying

const budget = new Map(); // `${source}|${account}|${kind}` -> [timestamps]
function allow(source, account, kind, max) {
    const k = `${source}|${account}|${kind}`;
    const now = Date.now();
    const list = (budget.get(k) || []).filter((t) => now - t < 60000);
    if (list.length >= max) { budget.set(k, list); return false; }
    list.push(now);
    budget.set(k, list);
    return true;
}

function ref12(msg) { return crypto.createHash('sha1').update(`${msg.source}|${msg.account}|${msg.ref || ''}`).digest('hex').slice(0, 12); }

function publishNotice(msg, a) {
    const code = a.kind === 'code';
    return be('notifier').publish({
        app: 'ingest', id: `ingest:${a.kind || 'rule'}:${ref12(msg)}`, cls: 'notification',
        title: clip(a.title || 'Ingest Controller', 80), text: clip(a._text || '', 600),
        data: { app: 'ingest', kind: a.kind || 'rule', source: msg.source, accountId: msg.account },
        ttlMs: code ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000, alert: true
    });
}

/** Dovecote system mail to an agent's mailbox. Codes are removed from it. */
function handOff(msg, mailbox, ruleId) {
    const dv = be('dovecote');
    if (!dv.isValidOwner(mailbox)) throw fail('NO_MAILBOX', `No mailbox "${mailbox}".`);
    const refHint = msg.source === 'email' ? `bridge_mail_message accountId=${msg.account} folder=${msg.folder || 'INBOX'} uid=${msg.uid}`
        : msg.source === 'sms' ? `bridge_text_messages accountId=${msg.account} chatGuid=${msg.chatGuid || ''}`
            : `exchange mailbox ${msg.account}`;
    const body = [
        `Ingest Controller hand-off (${msg.source} / ${msg.account})`,
        `From: ${redactCodes(msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from)}`,
        msg.source === 'sms' ? null : `Subject: ${redactCodes(msg.subject || '(none)')}`,
        `Rule: ${ruleId || 'n/a'}`,
        `Read the original: ${refHint}`,
        '',
        redactCodes(clip(msg.text || '', 1500)),
        '',
        '(verification codes are removed from hand-offs)'
    ].filter((x) => x != null).join('\n');
    return dv.deliverInboundMail({
        fromAddress: HANDOFF_FROM, fromLabel: HANDOFF_LABEL, toOwner: mailbox, to: [mailbox], cc: [],
        subject: `[Ingest] ${redactCodes(msg.source === 'sms' ? `Text from ${msg.from}` : (msg.subject || '(no subject)'))}`.slice(0, 300),
        body, format: 'text', spam: false, spamMeta: null, ownDomainFrom: true, trustedOwnSender: true, notifyLoop: false, headers: { 'x-ingest-handoff': '1' }
    });
}

/** The side effects every source shares. */
async function commonApply(msg, a, results) {
    if (a.type === 'notify') {
        if (!allow(msg.source, msg.account, 'notify', 30)) { results.push({ type: a.type, ok: false, error: 'rate limited' }); return true; }
        publishNotice(msg, a);
        results.push({ type: 'notify', kind: a.kind, ok: true });
        return true;
    }
    if (a.type === 'handToAgent') {
        if (!allow(msg.source, msg.account, 'hand', 20)) { results.push({ type: a.type, ok: false, error: 'rate limited' }); return true; }
        handOff(msg, a.mailbox, a.rule);
        results.push({ type: a.type, mailbox: a.mailbox, ok: true });
        return true;
    }
    return false;
}

async function ensureFolder(account, path) {
    const ma = be('mailAccounts');
    let have = [];
    try { have = (ma.listFolders(account).folders || []).map((f) => f.path); } catch (_) { have = []; }
    if (have.includes(path)) return;
    if (typeof ma.ensureFolder === 'function') await ma.ensureFolder(account, path);
}

function junkPath(account) {
    try {
        const folders = be('mailAccounts').listFolders(account).folders || [];
        const j = folders.find((f) => f.special === '\\Junk') || folders.find((f) => /^(junk|spam)/i.test(f.name || f.path));
        return j ? j.path : null;
    } catch (_) { return null; }
}

const appliers = {
    async email(msg, actions) {
        const ma = be('mailAccounts');
        const results = [];
        const folder = msg.folder || 'INBOX';
        const flags = [];
        for (const a of actions) {
            if (a.type === 'markRead' || a.type === 'silence') flags.push('\\Seen');
            else if (a.type === 'flag') flags.push('\\Flagged');
        }
        if (flags.length) {
            try { await ma.setFlags(msg.account, folder, [msg.uid], { add: Array.from(new Set(flags)) }); results.push({ type: 'flags', flags: Array.from(new Set(flags)), ok: true }); } catch (e) { results.push({ type: 'flags', ok: false, error: clip(e.message, 160) }); }
        }
        for (const a of actions) {
            try {
                if (await commonApply(msg, a, results)) continue;
                if (a.type === 'forward') {
                    if (!allow(msg.source, msg.account, 'forward', 20)) { results.push({ type: 'forward', ok: false, error: 'rate limited' }); continue; }
                    await ma.send(msg.account, {
                        to: a.to, subject: `Fwd: ${msg.subject || ''}`.slice(0, 300),
                        text: `---------- Forwarded message ----------\nFrom: ${msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from}\nSubject: ${msg.subject || ''}\n\n${msg.text || ''}`,
                        forwardFrom: { folder, uid: msg.uid }
                    });
                    results.push({ type: 'forward', to: a.to, ok: true });
                } else if (a.type === 'move') {
                    let to = a.to;
                    if (to === '@junk') to = junkPath(msg.account);
                    if (!to) { await ma.remove(msg.account, folder, [msg.uid]); results.push({ type: 'delete', ok: true, note: 'no Junk folder: Trash' }); continue; }
                    if (to !== folder) { await ensureFolder(msg.account, to); await ma.move(msg.account, folder, [msg.uid], to); }
                    results.push({ type: 'move', to, ok: true });
                } else if (a.type === 'delete') {
                    await ma.remove(msg.account, folder, [msg.uid]);
                    results.push({ type: 'delete', ok: true });
                }
            } catch (e) { results.push({ type: a.type, ok: false, error: clip(e.message, 160) }); }
        }
        return results;
    },
    async sms(msg, actions) {
        const results = [];
        const tm = be('textMessaging');
        for (const a of actions) {
            try {
                if (await commonApply(msg, a, results)) continue;
                if (a.type === 'markRead' || a.type === 'silence') {
                    if (a.type === 'markRead' || !actions.some((x) => x.type === 'markRead')) {
                        Promise.resolve(tm.markRead(msg.account, { chatGuid: msg.chatGuid })).catch((e) => log(`sms/${msg.account} markRead: ${e.message}`));
                    }
                    results.push({ type: a.type, ok: true });
                } else if (a.type === 'forward') {
                    if (!allow(msg.source, msg.account, 'forward', 20)) { results.push({ type: 'forward', ok: false, error: 'rate limited' }); continue; }
                    if (!be('dovecote').isValidOwner(String(a.to || '').toLowerCase())) throw fail('LOCAL_ONLY', 'Texts can only be forwarded to a Dovecote mailbox.');
                    handOff(msg, String(a.to).toLowerCase(), a.rule);
                    results.push({ type: 'forward', to: a.to, ok: true });
                } else if (a.type === 'delete') {
                    // only a one-to-one conversation with someone not in the contacts
                    if (msg.known !== false || msg.isGroup) { results.push({ type: 'delete', ok: false, error: 'only unknown one-to-one conversations are deleted' }); continue; }
                    Promise.resolve(tm.deleteChat(msg.account, { chatGuid: msg.chatGuid })).catch((e) => log(`sms/${msg.account} delete: ${e.message}`));
                    results.push({ type: 'delete', ok: true });
                }
            } catch (e) { results.push({ type: a.type, ok: false, error: clip(e.message, 160) }); }
        }
        return results;
    },
    // exchange: folder / read / flag are applied at insert (exchangeInbound); this is after(result)
    async exchange(msg, actions) {
        const results = [];
        for (const a of actions) {
            try {
                if (await commonApply(msg, a, results)) continue;
                if (a.type === 'forward') {
                    if (!allow(msg.source, msg.account, 'forward', 20)) { results.push({ type: 'forward', ok: false, error: 'rate limited' }); continue; }
                    be('dovecote').forwardMail(msg.account, { id: msg.id, to: a.to });
                    results.push({ type: 'forward', to: a.to, ok: true });
                }
            } catch (e) { results.push({ type: a.type, ok: false, error: clip(e.message, 160) }); }
        }
        return results;
    }
};

function logDecision(msg, res, dry, applied) {
    try {
        st(true).addLog({
            source: msg.source, account: msg.account, ref: msg.ref || null, dry, sender: redactCodes(msg.from || ''), subject: redactCodes(msg.subject || ''),
            actions: res.actions.map(publicAction).concat(applied ? [{ applied: applied.map((r) => (r.ok === false ? `${r.type}:failed` : `${r.type}:ok`)) }] : []),
            stoppedBy: res.stoppedBy
        });
    } catch (e) { log(`log: ${e.message}`); }
}

// ---------------------------------------------------------------- e-mail (IMAP bridge accounts)

function addrOf(x) { return x && typeof x === 'object' ? String(x.address || x.email || '') : String(x || ''); }
function parseJson(s, fb) { try { return JSON.parse(s || ''); } catch (_) { return fb; } }

function fromMailRow(account, folder, row) {
    const env = typeof row.env === 'string' ? parseJson(row.env, {}) : (row.env || {});
    const f = (env.from || [])[0] || {};
    const from = addrOf(f) || (/<([^>]+)>/.exec(row.sender || '') || [])[1] || String(row.sender || '');
    const headers = {};
    if (env.listUnsubscribe) headers['list-unsubscribe'] = String(env.listUnsubscribe);
    if (env.listUnsubscribePost) headers['list-unsubscribe-post'] = String(env.listUnsubscribePost);
    if ((env.replyTo || []).length) headers['reply-to'] = env.replyTo.map(addrOf).join(', ');
    if (env.inReplyTo) headers['in-reply-to'] = String(env.inReplyTo);
    return {
        source: 'email', account, folder, uid: row.uid, ref: `${folder}:${row.uid}`, id: String(row.uid),
        from: from.toLowerCase(), fromName: f.name || '', to: (env.to || []).map(addrOf), cc: (env.cc || []).map(addrOf),
        subject: row.subject || '', text: row.text || row.snippet || '', html: row.html || '', headers,
        date: row.date || Date.now(), messageId: row.msgid || '', row,
        getRaw: () => (be('mailAccounts').fetchRaw ? be('mailAccounts').fetchRaw(account, folder, row.uid) : null)
    };
}

const mailRunning = new Map();

/** After IDLE / sync: bypass accounts get the older rules; process accounts get the pipeline. */
function onMailArrived(accountId) {
    const id = String(accountId || '');
    if (mailRunning.has(id)) return mailRunning.get(id).then(() => onMailArrived(id));
    const p = (async () => {
        let row = null;
        try { row = accountRow('email', id); } catch (_) { row = null; }
        if (!row || row.mode !== 'process') return be('mailRules').applyNew(id);
        return processNewMail(id, row);
    })().finally(() => mailRunning.delete(id));
    mailRunning.set(id, p);
    return p;
}

async function processNewMail(id, row) {
    const ms = be('mailStore');
    const f = ms.getFolder(id, 'INBOX');
    const validity = f ? String(f.uidvalidity || '') : '';
    const mark = ms.getState(id, 'ingestUid');
    if (mark == null || String(ms.getState(id, 'ingestUidValidity') || '') !== validity) {
        ms.setState(id, 'ingestUid', ms.maxUid(id, 'INBOX'));
        ms.setState(id, 'ingestUidValidity', validity);
        return { processed: 0 };
    }
    let from = Number(mark) || 0;
    let processed = 0;
    for (let pass = 0; pass < 5; pass++) {
        const rows = ms.messagesAfterUid(id, 'INBOX', from, 100);
        if (!rows.length) break;
        from = rows[rows.length - 1].uid;
        ms.setState(id, 'ingestUid', from);
        ms.setState(id, 'rulesUid', from);
        for (const r of rows) { await processOne(fromMailRow(id, 'INBOX', r), row); processed++; }
    }
    return { processed };
}

async function processOne(msg, row) {
    const res = await runPipeline(msg, { row });
    if (!res.actions.length) return null;
    const dry = !row.applying;
    let applied = null;
    if (!dry) {
        applied = await appliers[msg.source](msg, res.actions);
        const legacy = res.actions.map((a) => a.rule).find((r) => String(r || '').startsWith('legacy:'));
        if (legacy) { try { be('mailStore').countRuleHits(legacy.slice(7), 1); } catch (_) { /* closed */ } }
    }
    logDecision(msg, res, dry, applied);
    log(`${msg.source}/${msg.account} ${msg.ref}: ${res.actions.map((a) => a.type + (a.to ? `:${a.to}` : '')).join(',')}${dry ? ' (dry-run)' : ''}`);
    return { res, applied, dry };
}

// ---------------------------------------------------------------- DS Exchange (Dovecote) inbound delivery

function bareAddress(v) {
    const s = addrOf(v);
    const m = /<([^>]+)>/.exec(s);
    return (m ? m[1] : s).trim().toLowerCase();
}

function fromExchange(d) {
    const h = {};
    for (const [k, v] of Object.entries(d.headers || {})) h[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v);
    const label = String(d.fromLabel || '');
    const nm = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(label);
    const meta = d.spamMeta || {};
    const body = String(d.body || '');
    return {
        source: 'exchange', account: d.toOwner, ref: '', folder: 'inbox',
        from: (bareAddress(label) && /@/.test(bareAddress(label)) ? bareAddress(label) : bareAddress(d.fromAddress)),
        fromName: nm ? nm[1].trim() : '', to: (d.to || []).map(bareAddress), cc: (d.cc || []).map(bareAddress),
        subject: String(d.subject || ''), text: d.format === 'html' ? body.replace(/<[^>]+>/g, ' ') : body, html: d.format === 'html' ? body : '',
        headers: h, date: Date.now(), messageId: h['message-id'] || '',
        spamScore: typeof meta.score === 'number' ? meta.score : null, spamRequired: typeof meta.required === 'number' ? meta.required : null,
        trustedOwn: d.trustedOwnSender === true || d.fromAddress === HANDOFF_FROM,
        getRaw: d.rawHeaders ? () => `${d.rawHeaders}\r\n\r\n${body}` : null
    };
}

/** Exchange folder names: '@junk' -> spam; inbox / spam / archive / deleted; archive:<x> or any other name = Archive subfolder. */
function exchangeFolder(to) {
    const t = String(to || '').trim();
    const l = t.toLowerCase();
    if (l === '@junk' || l === 'spam' || l === 'junk') return { folder: 'spam' };
    if (l === 'inbox') return { folder: 'inbox' };
    if (l === 'deleted' || l === 'trash') return { folder: 'deleted', deleted: true };
    if (l === 'archive') return { folder: 'archive' };
    return { folder: 'archive', archiveSubfolder: t.replace(/^archive:/i, '').slice(0, 80) };
}

/**
 * Called by mailGateway's deliver before the row is written. Returns null (deliver as before) or
 * { ingest: { folder, archiveSubfolder, deleted, read, flagged }, after(result) }.
 */
async function exchangeInbound(delivery) {
    let row = null;
    try { row = accountRow('exchange', String(delivery.toOwner || '')); } catch (_) { return null; }
    if (!row || row.mode !== 'process') return null;
    const msg = fromExchange(delivery);
    if (delivery.fromAddress === HANDOFF_FROM) return null; // our own hand-off: never loop
    const res = await runPipeline(msg, { row });
    if (!res.actions.length) return null;
    const dry = !row.applying;
    msg.ref = 'pending';
    if (dry) { logDecision(msg, res, true, null); log(`exchange/${msg.account}: ${res.actions.map((a) => a.type).join(',')} (dry-run)`); return null; }
    const ingest = {};
    const later = [];
    for (const a of res.actions) {
        if (a.type === 'markRead' || a.type === 'silence') ingest.read = true;
        else if (a.type === 'flag') ingest.flagged = true;
        else if (a.type === 'move') Object.assign(ingest, exchangeFolder(a.to));
        else if (a.type === 'delete') Object.assign(ingest, { folder: 'deleted', deleted: true });
        else later.push(a);
    }
    return {
        ingest,
        after: async (result) => {
            msg.id = result && result.id; msg.ref = (result && result.id) || msg.ref;
            const applied = await appliers.exchange(msg, later);
            logDecision(msg, res, false, [...res.actions.filter((a) => !later.includes(a)).map(() => ({ ok: true, type: 'insert' })), ...applied]);
            log(`exchange/${msg.account}: ${res.actions.map((a) => a.type + (a.to ? `:${a.to}` : '')).join(',')}`);
        }
    };
}

// ---------------------------------------------------------------- texts

function fromText(accountId, ev) {
    const m = ev.message || {};
    return {
        source: 'sms', account: accountId, chatGuid: ev.chatGuid, ref: `${ev.chatGuid}|${m.guid || ''}`, folder: null,
        from: String((m.sender && m.sender.address) || ev.chatTitle || ''), fromName: (m.sender && m.sender.name) || '', to: [], cc: [],
        subject: '', text: String(m.text || ''), html: '', headers: {}, date: m.date || Date.now(), messageId: m.guid || '',
        isGroup: !!ev.isGroup, known: ev.known === true ? true : (ev.known === false ? false : null)
    };
}

/** textMessaging.onProviderEvent, before the broadcast. Returns { suppressNotify } (fails open). */
async function textInbound(accountId, ev) {
    let row = null;
    try { row = accountRow('sms', String(accountId || '')); } catch (_) { return null; }
    if (!row || row.mode !== 'process') return null;
    const m = ev && ev.message;
    if (!m || m.fromMe || m.groupEvent) return null;
    const msg = fromText(accountId, ev);
    const res = await runPipeline(msg, { row });
    if (!res.actions.length) return null;
    const dry = !row.applying;
    if (dry) { logDecision(msg, res, true, null); log(`sms/${accountId}: ${res.actions.map((a) => a.type).join(',')} (dry-run)`); return null; }
    const applied = await appliers.sms(msg, res.actions);
    logDecision(msg, res, false, applied);
    log(`sms/${accountId}: ${res.actions.map((a) => a.type).join(',')}`);
    // no second "New Text Message" for a text that was silenced, deleted, or already announced as a code
    const suppressNotify = res.actions.some((a) => a.type === 'silence' || a.type === 'delete' || (a.type === 'notify' && a.kind === 'code'));
    return { suppressNotify };
}

// ---------------------------------------------------------------- dry run (MCP)

function mailAddressList(v) { return (Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean); }

async function messageFromRef(a, input) {
    const ref = input.ref && typeof input.ref === 'object' ? input.ref : null;
    if (input.message && typeof input.message === 'object') {
        const m = input.message;
        const headers = {};
        for (const [k, v] of Object.entries(m.headers || {})) headers[String(k).toLowerCase()] = String(v);
        return {
            source: a.source, account: a.account, ref: 'supplied', folder: m.folder || 'INBOX',
            from: String(m.from || '').trim().toLowerCase(), fromName: clip(m.fromName, 100), to: mailAddressList(m.to), cc: mailAddressList(m.cc),
            subject: clip(m.subject, 300), text: clip(m.text, 50000), html: '', headers, date: Date.now(), messageId: clip(m.messageId, 200),
            isGroup: m.isGroup === true, known: m.known === true ? true : (m.known === false ? false : null),
            spamScore: typeof m.spamScore === 'number' ? m.spamScore : null, spamRequired: typeof m.spamRequired === 'number' ? m.spamRequired : null
        };
    }
    if (!ref) throw fail('NO_MESSAGE', 'Give message { from, subject, text, ... } or ref (email { folder, uid }, exchange { id }, sms { chatGuid, guid }).');
    if (a.source === 'email') {
        const row = be('mailStore').getMessage(a.account, String(ref.folder || 'INBOX'), Number(ref.uid));
        if (!row) throw fail('NOT_FOUND', 'No such message in the synced copy.');
        return fromMailRow(a.account, String(ref.folder || 'INBOX'), row);
    }
    if (a.source === 'exchange') {
        const dv = be('dovecote');
        const row = typeof dv.getMessageRow === 'function' ? dv.getMessageRow(a.account, String(ref.id || '')) : null;
        if (!row) throw fail('NOT_FOUND', 'No such message in that mailbox.');
        return {
            source: 'exchange', account: a.account, ref: row.id, folder: row.folder, from: String(row.from_owner || '').toLowerCase(), fromName: '',
            to: parseJson(row.to_list, []).map(bareAddress), cc: parseJson(row.cc_list, []).map(bareAddress), subject: row.subject || '', text: row.body || '', html: '',
            headers: {}, date: Date.parse(row.created_at) || Date.now(), spamScore: parseJson(row.spam_meta, {}).score != null ? parseJson(row.spam_meta, {}).score : null
        };
    }
    const tm = be('textMessaging');
    const page = await tm.listMessages(a.account, String(ref.chatGuid || ''), { limit: 50 });
    const m = (page.messages || []).find((x) => x.guid === ref.guid) || (page.messages || [])[(page.messages || []).length - 1];
    if (!m) throw fail('NOT_FOUND', 'No such text.');
    return fromText(a.account, { chatGuid: ref.chatGuid, message: m, isGroup: false, known: null });
}

/** Run the account's pipeline over one message and show what would happen. No side effects. */
async function dryRun(input = {}) {
    const a = requireAccount(input.source, input.accountId);
    const row = accountRow(a.source, a.account);
    const msg = await messageFromRef(a, input);
    const deps = input.scoreSpam === false ? { spamd: { buildMessage: be('spamd').buildMessage, score: async () => ({ ok: false, error: 'skipped (scoreSpam:false)' }) } } : null;
    const res = await runPipeline(msg, { row, deps, forceAll: input.allModules === true });
    return {
        dryRun: true, source: a.source, accountId: a.account, mode: row ? row.mode : 'bypass', applying: row ? row.applying : false,
        note: !row || row.mode !== 'process' ? 'This account is in bypass: nothing runs on its mail yet; this is what process mode would do.' : undefined,
        message: { from: msg.from, subject: redactCodes(msg.subject || ''), ref: msg.ref },
        trace: res.trace, actions: res.actions.map(publicAction), stoppedBy: res.stoppedBy
    };
}

function recentLog(opts = {}) {
    const s1 = st(false);
    if (!s1) return { entries: [] };
    return { entries: s1.listLog({ source: opts.source ? validSource(opts.source) : null, account: opts.accountId || null, limit: opts.limit }) };
}

function _test_setBackends(b) { backends = b || null; budget.clear(); }
function _test_reset() { try { store._close(); } catch (_) { /* closed */ } opened = false; }
function _test_open(dir) { store.open(dir); opened = true; }

module.exports = {
    SOURCES, HANDOFF_FROM,
    listAccounts, setMode, listModules, configureModule, dryRun, recentLog,
    onMailArrived, exchangeInbound, textInbound,
    runPipeline, effectivePipeline, availableAccounts, fromMailRow, fromExchange, fromText, exchangeFolder,
    _test: { setBackends: _test_setBackends, reset: _test_reset, open: _test_open, appliers }
};
