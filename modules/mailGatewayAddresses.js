/**
 * Bidirectional Dovecote ↔ <bot>.<dept>@dream.737.jp.net mapping.
 * The mailbox table lives in config (config.mailGateway.mailboxes), not here.
 * This module only applies a mapping object it is given.
 */

'use strict';

const DEFAULT_DOMAIN = 'dream.737.jp.net';
// Display-only domain the Dovecote UI appends to bare mailbox names.
const INTERNAL_DISPLAY_DOMAIN = 'dream.co.jp';

// Shipped defaults (pending confirmation of tifa / pyra — those stay unmapped).
// Yukimi's public address is yukimi@dream.737.jp.net. Never map an external
// domain (ykazari@icloud.com or any other) as a local recipient.
const DEFAULT_MAILBOXES = Object.freeze({
    yukimi: 'yukimi',
    'sala.ops': 'sala',
    'menma.dev': 'menma',
    'rook.dev': 'rook',
    'cursor.dev': 'cursor',
    'claude.dev': 'claude',
    'frost.dev': 'frost',
    'hoshino.apocrypha': 'hoshino',
    'ivory.studio': 'ivory',
    'guren.lab': 'guren',
    'chiyo.web': 'chiyo'
});

function extractAddress(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const angled = [...text.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim());
    for (let i = angled.length - 1; i >= 0; i--) {
        const inner = angled[i].replace(/^mailto:/i, '').trim();
        if (inner.includes('@')) return inner;
    }
    let addr = text;
    if (/^mailto:/i.test(addr)) addr = addr.slice(7);
    addr = addr.replace(/^[<\s]+/, '').replace(/[>\s]+$/g, '');
    return addr.split(/\s+/)[0] || '';
}

function normalizeEmail(raw) {
    return extractAddress(raw).toLowerCase();
}

function splitLocalDomain(address) {
    const email = normalizeEmail(address);
    const at = email.lastIndexOf('@');
    if (at < 1 || at === email.length - 1) return null;
    return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

function cleanMailboxes(mailboxes) {
    const map = Object.create(null);
    if (!mailboxes || typeof mailboxes !== 'object' || Array.isArray(mailboxes)) {
        return map;
    }
    for (const [local, owner] of Object.entries(mailboxes)) {
        if (owner == null || owner === '') continue;
        const localPart = String(local || '').trim().toLowerCase();
        const mailbox = String(owner || '').trim().toLowerCase();
        if (!localPart || !mailbox) continue;
        // Keys are local-parts on the gateway domain only. A full address
        // (ykazari@icloud.com, anyone@elsewhere) is never a local recipient.
        if (localPart.includes('@')) continue;
        map[localPart] = mailbox;
    }
    return map;
}

function createMapping({ mailboxes, domain } = {}) {
    const table = cleanMailboxes(mailboxes);
    const host = String(domain || DEFAULT_DOMAIN).trim().toLowerCase() || DEFAULT_DOMAIN;
    const ownerToLocal = Object.create(null);
    for (const [local, owner] of Object.entries(table)) {
        if (!ownerToLocal[owner]) ownerToLocal[owner] = local;
    }
    return {
        domain: host,
        mailboxes: table,
        ownerToLocal
    };
}

function toMailbox(address, mapping) {
    const parts = splitLocalDomain(address);
    if (!parts || !mapping) return null;
    // Inbound RCPT is the public domain only. External domains (icloud.com,
    // gmail.com, …) are never local mailboxes, even when the local-part
    // matches yukimi / ykazari / a mapped bot.
    if (parts.domain !== mapping.domain) return null;
    return mapping.mailboxes[parts.local] || null;
}

function toExternal(owner, mapping) {
    if (!mapping || !owner) return null;
    const local = mapping.ownerToLocal[String(owner).trim().toLowerCase()];
    if (!local) return null;
    return `${local}@${mapping.domain}`;
}

function looksLikeEmail(token) {
    return String(token || '').includes('@');
}

function parseRecipientTokens(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.flatMap(parseRecipientTokens);
    if (typeof value !== 'string') {
        const err = new Error('Recipient must be a mailbox name or a list of names');
        err.code = 'UNKNOWN_RECIPIENT';
        throw err;
    }
    return value.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean);
}

/**
 * Classify one recipient token.
 * internal: a Dovecote mailbox (bare name, display-domain address, or mapped public address)
 * external: a foreign address, only when the gateway is enabled
 * unknown: reject
 */
function classifyRecipient(token, { mapping, enabled, isValidOwner }) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const email = looksLikeEmail(raw) ? normalizeEmail(raw) : '';
    if (email) {
        const parts = splitLocalDomain(email);
        const mapped = toMailbox(email, mapping);
        if (mapped) return { kind: 'internal', owner: mapped, address: email };
        if (parts && mapping && parts.domain === mapping.domain) {
            return { kind: 'unknown', token: email };
        }
        if (parts && parts.domain === INTERNAL_DISPLAY_DOMAIN && isValidOwner(parts.local)) {
            return { kind: 'internal', owner: parts.local, address: email };
        }
        // Foreign domains are outbound targets when the gateway is on, never
        // a Dovecote mailbox. ykazari@icloud.com is external, not Yukimi.
        if (enabled && parts) {
            return { kind: 'external', address: email };
        }
        return { kind: 'unknown', token: email };
    }
    const name = raw.toLowerCase();
    if (isValidOwner(name)) return { kind: 'internal', owner: name };
    return { kind: 'unknown', token: raw };
}

function classifyRecipients(to, cc, opts) {
    const toList = [];
    const ccList = [];
    const externalTo = [];
    const externalCc = [];
    const seen = new Set();
    const take = (token, intoInternal, intoExternal) => {
        const classified = classifyRecipient(token, opts);
        if (!classified) return;
        if (classified.kind === 'unknown') {
            const err = new Error(`Unknown recipient mailbox: ${classified.token}`);
            err.code = 'UNKNOWN_RECIPIENT';
            throw err;
        }
        const key = classified.kind === 'internal' ? classified.owner : classified.address;
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (classified.kind === 'internal') intoInternal.push(classified.owner);
        else intoExternal.push(classified.address);
    };
    for (const token of parseRecipientTokens(to)) take(token, toList, externalTo);
    for (const token of parseRecipientTokens(cc)) take(token, ccList, externalCc);
    if (!toList.length && !ccList.length && !externalTo.length && !externalCc.length) {
        const err = new Error('At least one recipient is required');
        err.code = 'EMPTY_RECIPIENTS';
        throw err;
    }
    return { toList, ccList, externalTo, externalCc };
}

function normalizePeerAddress(addr) {
    if (!addr) return '';
    let ip = String(addr);
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (ip === '::1') return '127.0.0.1';
    return ip;
}

function isAllowedPeer(addr, allowFrom) {
    const ip = normalizePeerAddress(addr);
    const list = Array.isArray(allowFrom) ? allowFrom : [];
    return list.some((allowed) => normalizePeerAddress(allowed) === ip);
}

function reservedSenderDomains(mapping) {
    const domains = [INTERNAL_DISPLAY_DOMAIN];
    if (mapping && mapping.domain) domains.push(mapping.domain);
    else domains.push(DEFAULT_DOMAIN);
    return domains;
}

function isReservedSenderDomain(domain, mapping) {
    const host = String(domain || '').toLowerCase();
    if (!host) return false;
    return reservedSenderDomains(mapping).some((base) => host === base || host.endsWith(`.${base}`));
}

const NULL_SENDER = 'mailer-daemon';

function stripMailFromParams(raw) {
    return String(raw || '').trim().replace(/\s+[A-Za-z0-9-]+=\S+/g, '').trim();
}

/**
 * External MAIL FROM must be a full addr-spec (or the null sender <> for
 * bounces) and must not use our domains or their subdomains.
 */
function validateEnvelopeSender(raw, mapping) {
    const addrPart = stripMailFromParams(raw);
    if (addrPart === '<>') {
        return { ok: true, address: NULL_SENDER, nullSender: true };
    }
    const email = normalizeEmail(addrPart);
    if (!email || !email.includes('@')) {
        return { ok: false, code: 501, message: '5.1.7 MAIL FROM must be a full address' };
    }
    const parts = splitLocalDomain(email);
    if (!parts) {
        return { ok: false, code: 501, message: '5.1.7 MAIL FROM must be a full address' };
    }
    if (isReservedSenderDomain(parts.domain, mapping)) {
        return { ok: false, code: 550, message: '5.7.1 Sender domain is not allowed' };
    }
    return { ok: true, address: `${parts.local}@${parts.domain}` };
}

/**
 * From is a display label only. Reject our domains so it cannot look like
 * bot mail; a bare name or a foreign address is kept as the label.
 */
function validateFromHeader(fromHeader, mapping) {
    if (!fromHeader || !String(fromHeader).trim()) return { ok: true, label: '' };
    const label = String(fromHeader).trim().replace(/[\r\n]+/g, ' ');
    const email = normalizeEmail(fromHeader);
    if (email && email.includes('@')) {
        const parts = splitLocalDomain(email);
        if (parts && isReservedSenderDomain(parts.domain, mapping)) {
            return { ok: false, code: 550, message: '5.7.1 From domain is not allowed' };
        }
    }
    return { ok: true, label };
}

function extractDisplayName(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const quoted = text.match(/^"([^"]*)"/);
    if (quoted) return quoted[1].trim();
    const angle = text.indexOf('<');
    if (angle > 0) return text.slice(0, angle).replace(/["']/g, '').trim();
    if (angle === 0) return '';
    return text.replace(/["']/g, '').trim();
}

// Cherokee / Cyrillic (and a few related) letters that look like Latin.
const CONFUSABLE_TO_LATIN = (() => {
    const map = Object.create(null);
    const pairs = [
        ['\u0410\u0430\u13AA', 'a'],
        ['\u0412\u0432', 'b'],
        ['\u0421\u0441\u13DF', 'c'],
        ['\u0415\u0435\u0401\u0451\u13AC', 'e'],
        ['\u050C\u050D', 'g'],
        ['\u041D\u043D\u13BB\u04BB', 'h'],
        ['\u0406\u0456\u0407\u0457\u04C0\u04CF', 'i'],
        ['\u0408\u0458', 'j'],
        ['\u041A\u043A', 'k'],
        ['\u13DE', 'l'],
        ['\u041C\u043C\u13B7', 'm'],
        ['\u041E\u043E\u13BE', 'o'],
        ['\u0420\u0440\u13E2', 'p'],
        ['\u051A\u051B', 'q'],
        ['\u13D2', 'r'],
        ['\u0405\u0455\u13D5', 's'],
        ['\u0422\u0442', 't'],
        ['\u13D9\u0475\u0474', 'v'],
        ['\u051C\u051D\u13B3', 'w'],
        ['\u0425\u0445', 'x'],
        ['\u0423\u0443\u04AE\u04AF', 'y']
    ];
    pairs.forEach(([from, to]) => {
        for (const ch of from) map[ch] = to;
    });
    return map;
})();

function foldConfusables(text) {
    let out = '';
    for (const ch of text) {
        out += CONFUSABLE_TO_LATIN[ch] || ch;
    }
    return out;
}

function normalizeSpoofText(text) {
    return foldConfusables(String(text || '').normalize('NFKC').replace(/\p{Cf}/gu, ''));
}

function splitCamelWords(word) {
    return String(word || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean);
}

function tokenizeSpoofWords(folded) {
    const trimmed = String(folded || '').replace(/^["']+|["']+$/g, '').trim();
    if (!trimmed) return [];
    const parts = trimmed.split(/[\s,;:|/\\._-]+/).map((part) => part.replace(/[<>]/g, '')).filter(Boolean);
    const words = [];
    parts.forEach((part) => {
        splitCamelWords(part).forEach((piece) => words.push(piece));
    });
    return words;
}

/**
 * Display-name / address spoof check. Does not decide route — callers that
 * took the inbound path still store route=inbound even when this flags.
 */
function inspectFromLabel(raw, opts) {
    const label = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
    if (!label) return { label: '', suspicious: false };
    const owners = new Set((opts && opts.owners ? opts.owners : []).map((n) => String(n).toLowerCase()));
    owners.add('yukimi');
    owners.add('ykazari');
    const mapping = (opts && opts.mapping) || createMapping();
    const locals = Object.assign(Object.create(null), mapping.mailboxes || {});

    const isProtected = (token) => {
        const lower = String(token || '').toLowerCase();
        return !!(lower && (owners.has(lower) || locals[lower]));
    };

    const looksInternalToken = (text) => {
        const folded = normalizeSpoofText(text);
        const lower = folded.toLowerCase().replace(/^["']+|["']+$/g, '').trim();
        if (!lower) return false;
        if (isProtected(lower)) return true;
        if (lower.includes('yukimi') || lower.includes('ykazari')) return true;
        const words = tokenizeSpoofWords(folded).map((word) => word.toLowerCase());
        if (words.some((word) => isProtected(word))) return true;
        let run = '';
        for (const word of words) {
            if (word.length === 1) {
                run += word;
                if (isProtected(run)) return true;
            } else {
                run = '';
            }
        }
        const emails = lower.match(/[^\s<>"]+@[^\s<>"]+/g) || [];
        for (const email of emails) {
            const parts = splitLocalDomain(email);
            if (!parts) continue;
            if (isReservedSenderDomain(parts.domain, mapping)) return true;
            if (isProtected(parts.local)) return true;
            const localBits = parts.local.split(/[._-]+/).filter(Boolean);
            if (localBits.some((bit) => isProtected(bit))) return true;
        }
        return false;
    };

    if (looksInternalToken(extractDisplayName(label))) return { label, suspicious: true };
    if (looksInternalToken(label)) return { label, suspicious: true };
    const addr = normalizeEmail(label);
    if (addr && looksInternalToken(addr)) return { label, suspicious: true };
    return { label, suspicious: false };
}

function fromHeaderMatchesEnvelope(fromHeader, envelope) {
    if (!fromHeader || !String(fromHeader).trim()) return true;
    const from = normalizeEmail(fromHeader);
    if (!from.includes('@')) return false;
    return from === normalizeEmail(envelope);
}

function parseAddressList(value) {
    if (!value) return [];
    return String(value)
        .split(',')
        .map((part) => normalizeEmail(part))
        .filter((addr) => addr && addr.includes('@'));
}

function recipientAllowed(address, allowlist) {
    if (!Array.isArray(allowlist) || !allowlist.length) return true;
    const email = normalizeEmail(address);
    if (!email) return false;
    return allowlist.some((rule) => {
        const token = String(rule || '').trim().toLowerCase();
        if (!token) return false;
        if (token.startsWith('@')) return email.endsWith(token);
        if (token.includes('@')) return email === token;
        return email.endsWith(`@${token}`);
    });
}

module.exports = {
    DEFAULT_DOMAIN,
    INTERNAL_DISPLAY_DOMAIN,
    DEFAULT_MAILBOXES,
    extractAddress,
    normalizeEmail,
    splitLocalDomain,
    createMapping,
    toMailbox,
    toExternal,
    looksLikeEmail,
    parseRecipientTokens,
    classifyRecipient,
    classifyRecipients,
    normalizePeerAddress,
    isAllowedPeer,
    NULL_SENDER,
    reservedSenderDomains,
    isReservedSenderDomain,
    validateEnvelopeSender,
    validateFromHeader,
    extractDisplayName,
    inspectFromLabel,
    fromHeaderMatchesEnvelope,
    parseAddressList,
    recipientAllowed
};
