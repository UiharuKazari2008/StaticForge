/**
 * The Ingest Controller's pipeline modules (modules/ingestController.js). A module is
 *
 *   { id, label, description, sources: ['email','exchange','sms'], defaults, validate(settings) -> clean,
 *     async run(message, ctx) -> { actions: [...], note?: {...} } }
 *
 * run() only DECIDES; the controller applies the actions after the whole pipeline. A module that
 * throws or times out is skipped (fail open). message (normalized by the controller):
 *   { source, account, ref, folder, from, fromName, to[], cc[], subject, text, html, headers{lowercase},
 *     date, messageId, isGroup, known, spamScore?, trustedOwn?, getRaw?() }
 * actions: { type: 'move', to } | { type: 'delete' } | { type: 'markRead' } | { type: 'flag' }
 *          | { type: 'forward', to } | { type: 'handToAgent', mailbox } | { type: 'silence' }   (texts: no notification, read)
 *          | { type: 'notify', kind, title, _text }       (_text never leaves the process: logs show [redacted])
 *          | { type: 'expire', afterMs?, afterReadMs? }  (routing only: tags the mail for the expiry sweep; never moves it now)
 * Folders: 'move' to '@junk' = the account's Junk (Exchange: Spam); email folder paths as the account has them;
 * Exchange: inbox, spam, archive, archive:<name> (any other name is an Archive subfolder), deleted.
 *   1. spamFilter    SpamAssassin spamd score (mail), known-number list + heuristic (texts); drops over the threshold.
 *   2. codeExtraction 4-8 digit codes / verification links -> a notification on Yukimi's devices only.
 *   3. routing       richer rules: from/to/subject/header/body, regex, negation, allowlist groups; plus the older
 *                    mail rules (mailAccountsRules) for e-mail so nothing regresses.
 *   4. expiry        tags Inbox mail with an expiry (N days after arrival, or N days after it was first read);
 *                    the periodic sweep (modules/ingestExpiry.js) moves due mail to Trash. Flagged mail never expires.
 */
'use strict';

const { randomUUID } = require('crypto');
const { extractCodes, redactCodes } = require('./ingestCodeRedact');

function bad(message, code) { return Object.assign(new Error(message), { code: code || 'BAD_SETTINGS' }); }
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Case-insensitive glob (only *) over an address or number. */
function globMatch(pattern, value) {
    let p = String(pattern || '').trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith('@')) p = `*${p}`;
    const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(String(value || '').toLowerCase());
}

function patternList(v, what, max) {
    if (v == null) return [];
    if (!Array.isArray(v)) throw bad(`${what} must be a list`);
    if (v.length > (max || 500)) throw bad(`${what}: at most ${max || 500} entries`);
    return v.map((x) => clip(x, 200)).filter(Boolean);
}

// ---------------------------------------------------------------- 1. spam filter

const SPAMD_DEFAULTS = Object.freeze({ host: '192.168.255.1', port: 783 });
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|ow\.ly|is\.gd|shorturl\.at|tiny\.cc|rebrand\.ly)\//i;
const SPAM_WORDS = [/\b(winner|you('| ha)ve won|prize|congratulations|selected)\b/i, /\bgift ?card\b/i, /\b(claim|act now|limited time|free msg|urgent)\b/i, /\b(crypto|bitcoin|investment opportunity)\b/i];
const SCAM_PHRASES = [/\b(unpaid toll|toll (balance|fee))\b/i, /\b(usps|ups|fedex|dhl)\b[^\n]{0,60}\b(held|undeliverable|redeliver|address)\b/i, /\baccount\b[^\n]{0,40}\b(suspended|locked|compromised|unusual)\b/i];

function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }
function numberListed(list, address) {
    const addr = String(address || '').toLowerCase();
    const dig = digitsOnly(addr);
    return list.some((n) => {
        const nd = digitsOnly(n);
        if (nd && nd.length >= 7 && dig.length >= 7) return dig.endsWith(nd) || nd.endsWith(dig);
        return globMatch(n, addr);
    });
}

/** Lightweight text-message score: > 0 when it looks like spam. Pure. */
function textSpamScore(msg) {
    const t = String(msg.text || '');
    const hasUrl = /https?:\/\/|\bwww\./i.test(t);
    if (!hasUrl && extractCodes(t).codes.length) return { score: 0, why: ['looks like a verification code'] };
    let score = 0;
    const why = [];
    if (SHORTENERS.test(t)) { score += 2; why.push('short link'); }
    let words = 0;
    for (const re of SPAM_WORDS) if (re.test(t)) words++;
    if (words) { score += Math.min(words, 3); why.push(`${words} bait word(s)`); }
    for (const re of SCAM_PHRASES) if (re.test(t)) { score += 2; why.push('scam phrasing'); break; }
    if (hasUrl && msg.known === false) { score += 1; why.push('unknown sender with a link'); }
    return { score, why };
}

const spamFilter = {
    id: 'spamFilter',
    label: 'Spam filter',
    description: 'Mail: SpamAssassin score from spamd (fails open if unreachable); the Exchange relay\'s own score is reused. Texts: known-spam numbers and a light heuristic. Over the threshold: Junk (or Trash).',
    sources: ['email', 'exchange', 'sms'],
    defaults: {
        host: SPAMD_DEFAULTS.host, port: SPAMD_DEFAULTS.port, timeoutMs: 4000, user: '',
        threshold: 8, action: 'junk', trustRelayScore: true, allowFrom: [],
        spamNumbers: [], textThreshold: 3, textAction: 'silence'
    },
    validate(s) {
        const x = isObj(s) ? s : {};
        const out = {};
        if (x.host != null) { out.host = clip(x.host, 100); if (out.host && !/^[A-Za-z0-9.\-:]+$/.test(out.host)) throw bad('host must be a host name or address'); }
        if (x.port != null) { out.port = Number(x.port); if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw bad('port must be 1-65535'); }
        if (x.timeoutMs != null) { out.timeoutMs = Number(x.timeoutMs); if (!(out.timeoutMs >= 500 && out.timeoutMs <= 15000)) throw bad('timeoutMs must be 500-15000'); }
        if (x.user != null) out.user = clip(x.user, 60);
        if (x.threshold != null) { out.threshold = Number(x.threshold); if (!(out.threshold >= 1 && out.threshold <= 100)) throw bad('threshold must be 1-100'); }
        if (x.action != null) { if (!['junk', 'trash'].includes(x.action)) throw bad('action is junk or trash'); out.action = x.action; }
        if (x.trustRelayScore != null) out.trustRelayScore = x.trustRelayScore !== false;
        if (x.allowFrom != null) out.allowFrom = patternList(x.allowFrom, 'allowFrom');
        if (x.spamNumbers != null) out.spamNumbers = patternList(x.spamNumbers, 'spamNumbers');
        if (x.textThreshold != null) { out.textThreshold = Number(x.textThreshold); if (!(out.textThreshold >= 1 && out.textThreshold <= 20)) throw bad('textThreshold must be 1-20'); }
        if (x.textAction != null) { if (!['silence', 'delete'].includes(x.textAction)) throw bad('textAction is silence or delete'); out.textAction = x.textAction; }
        return out;
    },
    isDestructive(s) { return !!s && (s.action === 'trash' || s.textAction === 'delete'); },
    async run(msg, ctx) {
        const s = ctx.settings;
        if ((s.allowFrom || []).some((p) => globMatch(p, msg.from))) return { actions: [], note: { skipped: 'allowFrom' } };
        if (msg.source === 'sms') {
            if (numberListed(s.spamNumbers || [], msg.from)) return { actions: [{ type: s.textAction === 'delete' ? 'delete' : 'silence' }], note: { reason: 'known spam number' } };
            if (msg.known === true) return { actions: [] };
            const r = textSpamScore(msg);
            if (r.score >= (s.textThreshold || 3)) return { actions: [{ type: s.textAction === 'delete' ? 'delete' : 'silence' }], note: { score: r.score, why: r.why } };
            return { actions: [], note: { score: r.score } };
        }
        if (msg.trustedOwn) return { actions: [], note: { skipped: 'own system mail' } };
        let result = null;
        if (msg.source === 'exchange' && s.trustRelayScore !== false && typeof msg.spamScore === 'number') {
            result = { ok: true, score: msg.spamScore, required: msg.spamRequired || null, symbols: [], via: 'relay' };
        } else {
            if (!s.host || !s.port) return { actions: [], note: { failOpen: 'spamd not configured' } };
            const spamd = ctx.deps.spamd;
            let raw = null;
            try { raw = msg.getRaw ? await msg.getRaw() : null; } catch (_) { raw = null; }
            if (!raw) raw = spamd.buildMessage(msg);
            result = await spamd.score(raw, { host: s.host, port: s.port, timeoutMs: s.timeoutMs, user: s.user });
            result.via = 'spamd';
        }
        if (!result.ok) return { actions: [], note: { failOpen: result.error } };
        const note = { score: result.score, required: result.required, via: result.via, symbols: (result.symbols || []).slice(0, 6) };
        if (result.score >= (s.threshold || 8)) {
            return { actions: [s.action === 'trash' ? { type: 'delete' } : { type: 'move', to: '@junk' }], note };
        }
        return { actions: [], note };
    }
};

// ---------------------------------------------------------------- 2. code extraction

function plainText(msg) {
    let t = String(msg.text || '');
    if (!t && msg.html) t = String(msg.html).replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    return t.replace(/\s+/g, ' ').slice(0, 6000);
}

function senderLabel(msg) {
    const n = String(msg.fromName || '').trim();
    if (n) return n.slice(0, 40);
    const m = /@([^@\s>]+)$/.exec(String(msg.from || ''));
    return (m ? m[1] : String(msg.from || '')).slice(0, 40);
}

const codeExtraction = {
    id: 'codeExtraction',
    label: 'Code extraction',
    description: 'Pulls 4-8 digit verification codes (and sign-in / verify links) out of mail and texts and notifies Yukimi\'s devices only. Codes are never logged, audited, or handed to agents.',
    sources: ['email', 'exchange', 'sms'],
    defaults: { links: true, markRead: false },
    validate(s) {
        const x = isObj(s) ? s : {};
        const out = {};
        if (x.links != null) out.links = x.links !== false;
        if (x.markRead != null) out.markRead = x.markRead === true;
        return out;
    },
    async run(msg, ctx) {
        const hay = `${msg.subject || ''}\n${plainText(msg)}`;
        const { codes, links } = extractCodes(hay);
        const useLinks = ctx.settings.links !== false ? links : [];
        if (!codes.length && !useLinks.length) return { actions: [] };
        const lines = [];
        if (codes.length) lines.push(`Code: ${codes.slice(0, 2).join(' / ')}`);
        if (useLinks.length) lines.push(useLinks[0]);
        const actions = [{ type: 'notify', kind: 'code', title: `Verification code from ${senderLabel(msg)}`, _text: lines.join('\n'), codes: codes.length, links: useLinks.length }];
        if (ctx.settings.markRead === true) actions.push({ type: 'markRead' });
        return { actions, note: { codes: codes.length, links: useLinks.length } };
    }
};

// ---------------------------------------------------------------- 3. routing rules

const FIELDS = ['from', 'to', 'subject', 'body', 'header', 'any'];
const OPS = ['contains', 'equals', 'startsWith', 'endsWith', 'regex', 'in', 'exists'];
const MAX_RULES = 200;
const MAX_GROUPS = 50;

function safeRegex(src) {
    const s = clip(src, 200);
    if (!s) throw bad('regex is empty');
    if (/(\([^)]*[+*][^)]*\))[+*{]/.test(s) || /\.\*.*\.\*.*\.\*/.test(s)) throw bad('regex too expensive; simplify it');
    try { return new RegExp(s, 'i'); } catch (e) { throw bad(`bad regex: ${e.message}`); }
}

function normalizeCond(c, groups) {
    if (!isObj(c)) throw bad('each condition is an object { field, op?, value?, group?, not? }');
    const field = String(c.field || '').trim();
    if (!FIELDS.includes(field)) throw bad(`condition field is one of ${FIELDS.join(', ')}`);
    const op = String(c.op || (c.group ? 'in' : 'contains'));
    if (!OPS.includes(op)) throw bad(`condition op is one of ${OPS.join(', ')}`);
    const out = { field, op };
    if (field === 'header') { out.header = clip(c.header, 80).toLowerCase(); if (!out.header) throw bad('a header condition needs header: <name>'); }
    if (op === 'in') {
        out.group = clip(c.group, 60);
        if (!out.group || !Object.prototype.hasOwnProperty.call(groups, out.group)) throw bad(`unknown group "${out.group}" (define it in settings.groups)`);
    } else if (op !== 'exists') {
        const vals = Array.isArray(c.value) ? c.value : [c.value];
        out.value = vals.map((v) => clip(v, 200)).filter(Boolean).slice(0, 20);
        if (!out.value.length) throw bad('a condition needs a value');
        if (op === 'regex') out.value.forEach(safeRegex);
    }
    if (c.not === true) out.not = true;
    return out;
}

function normalizeActions(a, source) {
    const x = isObj(a) ? a : {};
    const out = {};
    if (x.markRead === true) out.markRead = true;
    if (x.flag === true) out.flag = true;
    if (x.delete === true) out.delete = true;
    if (x.moveTo != null && String(x.moveTo).trim()) out.moveTo = clip(x.moveTo, 200);
    if (x.forwardTo != null && String(x.forwardTo).trim()) out.forwardTo = clip(x.forwardTo, 200);
    if (x.handTo != null && String(x.handTo).trim()) out.handTo = clip(x.handTo, 60).toLowerCase();
    if (x.notify === true || (typeof x.notify === 'string' && x.notify.trim())) out.notify = x.notify === true ? true : clip(x.notify, 80);
    if (x.silence === true) out.silence = true;
    if (x.expire != null) {
        if (source === 'sms') throw bad('expire is for mail (email / exchange), not texts.');
        const e = isObj(x.expire) ? x.expire : {};
        const ex = {};
        if (e.after != null) ex.afterMs = parseDuration(e.after, 'expire.after');
        if (e.afterRead != null) ex.afterReadMs = parseDuration(e.afterRead, 'expire.afterRead');
        if (!ex.afterMs && !ex.afterReadMs) throw bad('expire needs after ("40d") and / or afterRead ("7d")');
        out.expire = ex;
    }
    if (out.moveTo && out.delete) throw bad('Pick moveTo or delete, not both.');
    if (out.moveTo && source === 'sms') throw bad('Texts have no folders: use delete, silence, markRead, handTo, notify or forwardTo.');
    if (out.flag && source === 'sms') throw bad('flag is not available for texts.');
    if (!Object.keys(out).length) throw bad('A rule needs an action: markRead, flag, moveTo, delete, forwardTo, handTo, notify, silence or expire.');
    return out;
}

function normalizeRules(rules, groups, source) {
    if (!Array.isArray(rules)) throw bad('rules must be a list');
    if (rules.length > MAX_RULES) throw bad(`At most ${MAX_RULES} rules.`);
    return rules.map((r, i) => {
        if (!isObj(r)) throw bad(`rule ${i + 1} must be an object`);
        const m = isObj(r.match) ? r.match : {};
        const flat = [];
        for (const k of ['from', 'to', 'subject', 'body']) if (r[k] != null && String(r[k]).trim()) flat.push({ field: k, op: 'contains', value: r[k] });
        const all = (Array.isArray(m.all) ? m.all : []).concat(flat).map((c) => normalizeCond(c, groups));
        const any = (Array.isArray(m.any) ? m.any : []).map((c) => normalizeCond(c, groups));
        const none = (Array.isArray(m.none) ? m.none : []).map((c) => normalizeCond(c, groups));
        if (!all.length && !any.length && !none.length) throw bad(`rule ${i + 1} needs conditions (match.all / any / none)`);
        return {
            id: clip(r.id, 40) || `r-${randomUUID().slice(0, 8)}`,
            name: clip(r.name, 120),
            enabled: r.enabled !== false,
            stop: r.stop !== false,
            match: { all, any, none },
            actions: normalizeActions(r.actions, source)
        };
    });
}

function fieldText(msg, c) {
    switch (c.field) {
        case 'from': return `${msg.from || ''} ${msg.fromName || ''}`;
        case 'to': return [...(msg.to || []), ...(msg.cc || [])].join(' ');
        case 'subject': return String(msg.subject || '');
        case 'body': return String(msg.text || '').slice(0, 50000);
        case 'header': return String((msg.headers || {})[c.header] == null ? '' : msg.headers[c.header]);
        default: return `${msg.from || ''} ${msg.fromName || ''} ${[...(msg.to || []), ...(msg.cc || [])].join(' ')} ${msg.subject || ''} ${String(msg.text || '').slice(0, 20000)}`;
    }
}

function addressesOf(msg, c) {
    if (c.field === 'from') return [msg.from || ''];
    if (c.field === 'to') return [...(msg.to || []), ...(msg.cc || [])];
    return [fieldText(msg, c)];
}

function evalCond(msg, c, groups) {
    let hit;
    if (c.op === 'in') hit = addressesOf(msg, c).some((a) => (groups[c.group] || []).some((p) => globMatch(p, a)));
    else if (c.op === 'exists') hit = c.field === 'header' ? (msg.headers || {})[c.header] != null && String(msg.headers[c.header]) !== '' : fieldText(msg, c).trim() !== '';
    else {
        const hay = fieldText(msg, c).toLowerCase();
        const test = (v) => {
            const n = String(v).toLowerCase();
            if (c.op === 'equals') return hay.trim() === n || addressesOf(msg, c).some((a) => String(a).toLowerCase() === n);
            if (c.op === 'startsWith') return hay.startsWith(n);
            if (c.op === 'endsWith') return hay.endsWith(n);
            if (c.op === 'regex') return safeRegex(v).test(fieldText(msg, c).slice(0, 20000));
            return hay.includes(n);
        };
        hit = c.value.some(test);
    }
    return c.not ? !hit : hit;
}

function ruleMatches(msg, rule, groups) {
    const m = rule.match;
    if (m.all.length && !m.all.every((c) => evalCond(msg, c, groups))) return false;
    if (m.any.length && !m.any.some((c) => evalCond(msg, c, groups))) return false;
    if (m.none.length && m.none.some((c) => evalCond(msg, c, groups))) return false;
    return true;
}

function actionsOf(a, msg, rule) {
    const out = [];
    if (a.markRead) out.push({ type: 'markRead' });
    if (a.flag) out.push({ type: 'flag' });
    if (a.silence) out.push({ type: 'silence' });
    if (a.notify) out.push({ type: 'notify', kind: 'rule', title: typeof a.notify === 'string' ? a.notify : 'Mail rule', _text: redactCodes(`From ${msg.fromName || msg.from}: ${msg.subject || String(msg.text || '').slice(0, 100)}`) });
    if (a.forwardTo) out.push({ type: 'forward', to: a.forwardTo });
    if (a.handTo) out.push({ type: 'handToAgent', mailbox: a.handTo });
    if (a.expire) out.push(Object.assign({ type: 'expire' }, a.expire));
    if (a.delete) out.push({ type: 'delete' });
    else if (a.moveTo) out.push({ type: 'move', to: a.moveTo });
    out.forEach((x) => { x.rule = rule; });
    return out;
}

function pseudoRow(msg) {
    return {
        sender: `${msg.fromName || ''} ${msg.from || ''}`.trim(), recipients: [...(msg.to || []), ...(msg.cc || [])].join(', '),
        subject: msg.subject || '',
        env: { from: [{ name: msg.fromName || '', address: msg.from || '' }], to: (msg.to || []).map((a) => ({ address: a })), cc: (msg.cc || []).map((a) => ({ address: a })) }
    };
}

const routing = {
    id: 'routing',
    label: 'Routing rules',
    description: 'Rules over from / to / subject / header / body (contains, equals, regex, in an allowlist group), with negation. Actions: moveTo a folder, delete (Trash), markRead, flag, forwardTo, handTo an agent mailbox, notify, silence (texts), expire { after, afterRead } (mail: the expiry sweep moves it to Trash later). For e-mail the older mail rules still run first (includeLegacyRules).',
    sources: ['email', 'exchange', 'sms'],
    defaults: { rules: [], groups: {}, includeLegacyRules: true },
    validate(s, source) {
        const x = isObj(s) ? s : {};
        const out = {};
        if (x.groups != null) {
            if (!isObj(x.groups)) throw bad('groups is { name: [address patterns] }');
            if (Object.keys(x.groups).length > MAX_GROUPS) throw bad(`At most ${MAX_GROUPS} groups.`);
            out.groups = {};
            for (const [name, list] of Object.entries(x.groups)) {
                if (!/^[A-Za-z0-9 _-]{1,60}$/.test(name)) throw bad('group names are letters, digits, space, _ and -');
                out.groups[name] = patternList(list, `group ${name}`);
            }
        }
        if (x.includeLegacyRules != null) out.includeLegacyRules = x.includeLegacyRules !== false;
        if (x.rules != null) out.rules = normalizeRules(x.rules, out.groups || {}, source);
        return out;
    },
    isDestructive(s) { return !!s && Array.isArray(s.rules) && s.rules.some((r) => r.enabled && (r.actions.delete || r.actions.forwardTo)); },
    async run(msg, ctx) {
        const s = ctx.settings;
        const groups = s.groups || {};
        const actions = [];
        const note = { rules: [] };
        let terminal = false;
        if (msg.source === 'email' && s.includeLegacyRules !== false && ctx.deps.legacyRules) {
            let legacy = [];
            try { legacy = ctx.deps.legacyRules(msg.account) || []; } catch (_) { legacy = []; }
            const row = msg.row || pseudoRow(msg);
            const hit = legacy.find((r) => ctx.deps.legacyMatches(r, row));
            if (hit) {
                const a = hit.actions || {};
                actionsOf({ markRead: a.markRead, flag: a.flag, moveTo: a.moveTo, delete: a.delete }, msg, `legacy:${hit.id}`).forEach((x) => actions.push(x));
                note.rules.push(`legacy:${hit.id}`);
                if (a.moveTo || a.delete) terminal = true;
            }
        }
        if (!terminal) {
            for (const rule of s.rules || []) {
                if (!rule.enabled || !ruleMatches(msg, rule, groups)) continue;
                note.rules.push(rule.id);
                actionsOf(rule.actions, msg, rule.id).forEach((x) => actions.push(x));
                if (rule.actions.moveTo || rule.actions.delete || rule.stop !== false) break;
            }
        }
        return { actions, note: note.rules.length ? note : undefined };
    }
};

// ---------------------------------------------------------------- 4. expiry

const DAY = 24 * 60 * 60 * 1000;
const UNITS = { m: 60 * 1000, h: 60 * 60 * 1000, d: DAY, w: 7 * DAY };
/** '40d' / '12h' / '90m' / '2w' / a number of ms -> ms (1 hour .. 10 years). */
function parseDuration(v, what) {
    let ms = null;
    if (typeof v === 'number') ms = v;
    else {
        const m = /^\s*(\d+(?:\.\d+)?)\s*([mhdw])\s*$/i.exec(String(v == null ? '' : v));
        if (m) ms = Number(m[1]) * UNITS[m[2].toLowerCase()];
    }
    if (!Number.isFinite(ms) || ms < UNITS.h || ms > 3650 * DAY) throw bad(`${what || 'duration'} is like "40d", "12h" or "2w" (1 hour to 10 years)`);
    return Math.round(ms);
}

/** Yukimi's payment-failure notices (from Tsubame's inbox janitor, Nov 19 2026). */
const PAYMENT_FAILURE_SUBJECT = "missed (a |your )?(\\w+ )*payment|late payment|payment isn.?t made|problem receiving your payment|didn.?t go through|was unsuccessful|payment alert|autopay failed|payment (failed|declined|didn.?t go through|problem)|couldn.?t process payment|past due|missed payment|on hold|failed payment|payment was declined|collections";
const EXPIRY_SUBJECT_MAX = 300; // subjects are clipped before matching: a bounded input for any pattern
const MAX_EXPIRY_RULES = 50;

/**
 * Subject patterns for expiry rules: longer than routing's (the default is ~330 chars). Rejected: a group that ends in a
 * quantifier and is quantified again ((a+)+, (\w*)*), and anything slow on worst-case probes (run under a vm timeout,
 * so a catastrophic pattern cannot hang the server while it is checked). Subjects are clipped to 300 chars when matched.
 */
const vm = require('vm');
const probeScript = new vm.Script('for (const p of probes) re.test(p)');
function expiryRegex(src) {
    const s = String(src == null ? '' : src).trim();
    if (!s) throw bad('subjectRegex is empty');
    if (s.length > 1000) throw bad('subjectRegex: at most 1000 characters');
    if (/\((?:[^()\\]|\\.)*[+*}]\)[+*{]/.test(s)) throw bad('subjectRegex too expensive (a quantified group ending in a quantifier); simplify it');
    let re;
    try { re = new RegExp(s, 'i'); } catch (e) { throw bad(`bad subjectRegex: ${e.message}`); }
    const probes = [];
    for (const c of ['a', '1', ' ', 'ab', 'a ', 'aaaa ', '- ', '.']) probes.push(`${c.repeat(Math.floor(EXPIRY_SUBJECT_MAX / c.length) - 1)}!`);
    try { probeScript.runInNewContext({ re, probes }, { timeout: 100 }); } catch (e) { throw bad('subjectRegex too expensive; simplify it'); }
    return re;
}

function normalizeExpiryRules(rules) {
    if (!Array.isArray(rules)) throw bad('expiry rules must be a list');
    if (rules.length > MAX_EXPIRY_RULES) throw bad(`At most ${MAX_EXPIRY_RULES} expiry rules.`);
    const ids = new Set();
    return rules.map((r, i) => {
        if (!isObj(r)) throw bad(`expiry rule ${i + 1} must be an object`);
        const out = { id: clip(r.id, 40) || `x-${randomUUID().slice(0, 8)}`, name: clip(r.name, 120), enabled: r.enabled !== false };
        if (ids.has(out.id)) throw bad(`expiry rule id "${out.id}" is used twice`);
        ids.add(out.id);
        if (r.subjectRegex != null && String(r.subjectRegex).trim()) { expiryRegex(r.subjectRegex); out.subjectRegex = String(r.subjectRegex).trim(); }
        const m = isObj(r.match) ? r.match : null;
        if (m) {
            const all = (Array.isArray(m.all) ? m.all : []).map((c) => normalizeCond(c, {}));
            const any = (Array.isArray(m.any) ? m.any : []).map((c) => normalizeCond(c, {}));
            const none = (Array.isArray(m.none) ? m.none : []).map((c) => normalizeCond(c, {}));
            if (all.length || any.length || none.length) out.match = { all, any, none };
        }
        if (r.after != null) out.afterMs = parseDuration(r.after, `expiry rule ${i + 1} after`);
        else if (r.afterMs != null) out.afterMs = parseDuration(Number(r.afterMs), `expiry rule ${i + 1} afterMs`);
        if (r.afterRead != null) out.afterReadMs = parseDuration(r.afterRead, `expiry rule ${i + 1} afterRead`);
        else if (r.afterReadMs != null) out.afterReadMs = parseDuration(Number(r.afterReadMs), `expiry rule ${i + 1} afterReadMs`);
        if (!out.afterMs && !out.afterReadMs) throw bad(`expiry rule ${i + 1} needs after ("40d") and / or afterRead ("7d")`);
        return out;
    });
}

const DEFAULT_EXPIRY_RULES = Object.freeze(normalizeExpiryRules([
    { id: 'payment-failure', name: 'Payment-failure notices: 40 days after they arrive', subjectRegex: PAYMENT_FAILURE_SUBJECT, after: '40d' },
    { id: 'read-7d', name: 'Any mail: 7 days after it was first read', afterRead: '7d' }
]).map((r) => Object.freeze(r)));

const regexCache = new Map();
function cachedRegex(src) {
    let re = regexCache.get(src);
    if (!re) { re = new RegExp(src, 'i'); if (regexCache.size > 200) regexCache.clear(); regexCache.set(src, re); }
    return re;
}

/**
 * The rule expiry of one message (pure): { afterMs, afterReadMs, rules: [ids] } or null.
 * afterMs: the shortest "after arrival" of the matching rules; afterReadMs: the shortest "after read".
 */
function expiryFor(msg, rules) {
    let afterMs = null;
    let afterReadMs = null;
    const hit = [];
    const subj = { subject: String(msg.subject || '').slice(0, EXPIRY_SUBJECT_MAX) };
    const m2 = Object.assign({}, msg, subj);
    for (const r of rules || []) {
        if (!r || r.enabled === false) continue;
        if (r.subjectRegex && !cachedRegex(r.subjectRegex).test(subj.subject)) continue;
        if (r.match && !ruleMatches(m2, { match: r.match }, {})) continue;
        hit.push(r.id);
        if (r.afterMs) afterMs = afterMs == null ? r.afterMs : Math.min(afterMs, r.afterMs);
        if (r.afterReadMs) afterReadMs = afterReadMs == null ? r.afterReadMs : Math.min(afterReadMs, r.afterReadMs);
    }
    return hit.length ? { afterMs, afterReadMs, rules: hit } : null;
}

const expiry = {
    id: 'expiry',
    label: 'Expiry',
    description: 'Tags Inbox mail with an expiry when it arrives (and backfills what is already there): a rule matches the subject (regex) / from / to / header and expires the mail `after` arrival (e.g. "40d") or `afterRead` (e.g. "7d" after it was first seen read). Routing rules can also set expire { after, afterRead }. A sweep (every 20 minutes, or ingest_expiry_sweep) moves due mail to Trash (Deleted Messages); dry-run only logs "would expire". Flagged mail never expires (checked again right before the move).',
    sources: ['email', 'exchange'],
    defaults: { rules: DEFAULT_EXPIRY_RULES, maxPerSweep: 200 },
    validate(s) {
        const x = isObj(s) ? s : {};
        const out = {};
        if (x.rules != null) out.rules = normalizeExpiryRules(x.rules);
        if (x.maxPerSweep != null) { out.maxPerSweep = Number(x.maxPerSweep); if (!Number.isInteger(out.maxPerSweep) || out.maxPerSweep < 1 || out.maxPerSweep > 2000) throw bad('maxPerSweep must be 1-2000'); }
        return out;
    },
    // it moves mail to Trash: enabling it needs confirm:true
    isDestructive() { return true; },
    async run(msg, ctx) {
        const t = expiryFor(msg, ctx.settings.rules);
        if (!t) return { actions: [] };
        const now = Date.now();
        const note = { rules: t.rules };
        if (t.afterMs) note.expiresAt = new Date(Math.min(Number(msg.date) || now, now) + t.afterMs).toISOString();
        if (t.afterReadMs) note.afterReadDays = Math.round((t.afterReadMs / DAY) * 100) / 100;
        return { actions: [], note };
    }
};

const MODULES = [spamFilter, codeExtraction, routing, expiry];
const BY_ID = new Map(MODULES.map((m) => [m.id, m]));

module.exports = { MODULES, BY_ID, spamFilter, codeExtraction, routing, expiry, expiryFor, parseDuration, normalizeExpiryRules, DEFAULT_EXPIRY_RULES, PAYMENT_FAILURE_SUBJECT, globMatch, textSpamScore, numberListed, ruleMatches, normalizeRules, normalizeActions, bad, SPAMD_DEFAULTS };
