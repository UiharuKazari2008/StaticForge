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
const DEFAULT_MAILBOXES = Object.freeze({
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
        const mapped = toMailbox(email, mapping);
        if (mapped) return { kind: 'internal', owner: mapped, address: email };
        const parts = splitLocalDomain(email);
        if (parts && mapping && parts.domain === mapping.domain) {
            return { kind: 'unknown', token: email };
        }
        if (parts && parts.domain === INTERNAL_DISPLAY_DOMAIN && isValidOwner(parts.local)) {
            return { kind: 'internal', owner: parts.local, address: email };
        }
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
    return reservedSenderDomains(mapping).includes(host);
}

/**
 * External MAIL FROM must be a full addr-spec and must not use our domains,
 * so inbound mail cannot look like it came from a Dovecote mailbox.
 */
function validateEnvelopeSender(raw, mapping) {
    const email = normalizeEmail(raw);
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
    reservedSenderDomains,
    isReservedSenderDomain,
    validateEnvelopeSender,
    fromHeaderMatchesEnvelope,
    parseAddressList,
    recipientAllowed
};
