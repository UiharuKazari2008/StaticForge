/**
 * Dreamscape Exchange Server — admin console business logic.
 * Access: Yukimi, Sala, Tsubame (mailroom). Everyone else is denied.
 * Mutations are audit-logged (actor, target, action, time). No secrets.
 */

'use strict';

const crypto = require('crypto');
const addresses = require('./mailGatewayAddresses');
const { sanitizeHtml } = require('./dovecoteSanitize');
const { getDb, isReady } = require('./mailExchangeDatabase');

const HUMAN_OWNER = 'yukimi';
const SALA_OWNER = 'sala';
const TSUBAME_OWNER = 'tsubame';
const MAILROOM_ROLE = 'mailroom';

const EXCHANGE_ADMINS = Object.freeze([HUMAN_OWNER, SALA_OWNER, TSUBAME_OWNER, MAILROOM_ROLE]);
const EXCHANGE_ADMIN_SET = new Set(EXCHANGE_ADMINS);

const YUKIMI_LOCAL = 'kazari.ops';
const YUKIMI_ALIASES = Object.freeze(['kazari', 'yukimi.kazari', 'yukimi']);
const TSUBAME_LOCAL = 'tsubame.ops';
const MAILROOM_CATCHALL = 'mailroom.ops';

const KEY_PREFIX = 'dsmbox_';
const PUBLIC_DOMAIN = addresses.DEFAULT_DOMAIN;
const CONFIRM_DELETE = 'DELETE';

class MailExchangeError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'MailExchangeError';
        this.code = code || 'EXCHANGE_ERROR';
    }
}

let testConfig = null;

function setTestConfig(config) {
    testConfig = config || null;
}

function resetTestConfig() {
    testConfig = null;
}

function nowIso() {
    return new Date().toISOString();
}

function publicConfig() {
    if (testConfig && testConfig.config) return testConfig.config;
    try {
        const gr = require('./globalResources');
        return (gr.getConfig() || {}).mailExchange || {};
    } catch (_err) {
        return {};
    }
}

function gatewayConfig() {
    if (testConfig && testConfig.mailGateway) return testConfig.mailGateway;
    try {
        const gr = require('./globalResources');
        return (gr.getConfig() || {}).mailGateway || {};
    } catch (_err) {
        return {};
    }
}

function isEnabled() {
    return publicConfig().enabled === true;
}

function requireReady() {
    if (!isReady()) throw new MailExchangeError('Exchange database is not initialized', 'NOT_READY');
}

function normalizeOwner(value) {
    return String(value || '').trim().toLowerCase();
}

function canonicalizeAdmin(actor) {
    const owner = normalizeOwner(actor);
    if (owner === MAILROOM_ROLE) return TSUBAME_OWNER;
    return owner;
}

function isExchangeAdmin(actor) {
    return EXCHANGE_ADMIN_SET.has(normalizeOwner(actor));
}

function requireExchangeAdmin(actor, action, target) {
    if (isExchangeAdmin(actor)) return canonicalizeAdmin(actor);
    audit(actor || 'unknown', action || 'access', target || null, false, 'exchange admin required');
    throw new MailExchangeError('Exchange admin required', 'FORBIDDEN');
}

function requireEnabled(actor, action, target) {
    if (isEnabled()) return;
    audit(actor || 'unknown', action || 'access', target || null, false, 'exchange disabled');
    throw new MailExchangeError('Dreamscape Exchange Server is disabled', 'DISABLED');
}

function requireConfirm(confirm, action) {
    if (confirm === true) return;
    throw new MailExchangeError(`confirm:true is required for ${action}`, 'CONFIRM_REQUIRED');
}

function hashKey(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function generateMailboxKey() {
    return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function audit(actor, action, target, success, detail) {
    if (!isReady()) return;
    try {
        const safe = detail ? String(detail).slice(0, 500) : null;
        if (safe && /dsmbox_|relay(Read|Admin)Token|Bearer\s+\S+/i.test(safe)) {
            getDb().prepare(
                `INSERT INTO exchange_audit (ts, actor, action, target, detail, success) VALUES (?, ?, ?, ?, ?, ?)`
            ).run(nowIso(), String(actor || 'unknown'), action, target || null, '[redacted]', success ? 1 : 0);
            return;
        }
        getDb().prepare(
            `INSERT INTO exchange_audit (ts, actor, action, target, detail, success) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(nowIso(), String(actor || 'unknown'), action, target || null, safe, success ? 1 : 0);
    } catch (err) {
        console.error('Exchange audit log write failed:', err.message);
    }
}

function listAudit({ limit } = {}) {
    requireReady();
    const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return getDb().prepare(
        `SELECT ts, actor, action, target, detail, success FROM exchange_audit ORDER BY id DESC LIMIT ?`
    ).all(cap);
}

function shippedMailboxes() {
    const gw = gatewayConfig();
    const table = gw.mailboxes && typeof gw.mailboxes === 'object'
        ? gw.mailboxes
        : addresses.DEFAULT_MAILBOXES;
    return addresses.cleanMailboxes(table);
}

function invalidLocalPart(local) {
    const part = String(local || '').trim().toLowerCase();
    if (!part) return 'Local-part is required';
    if (part.includes('@')) return 'Map bots and users to <name>.<dept> on dream.737.jp.net, never an external domain';
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(part)) return 'Local-part must be name or name.dept';
    return null;
}

function localPartFor(owner, dept) {
    const name = normalizeOwner(owner);
    const d = String(dept || '').trim().toLowerCase();
    if (name === HUMAN_OWNER) return YUKIMI_LOCAL;
    if (name === TSUBAME_OWNER || name === MAILROOM_ROLE) return TSUBAME_LOCAL;
    if (!d) throw new MailExchangeError('Department is required (e.g. ops, dev, lab)', 'INVALID_LOCAL');
    return `${name}.${d}`;
}

function publicAddress(local) {
    return `${local}@${PUBLIC_DOMAIN}`;
}

function mailboxRowToView(row, shippedLocal) {
    const local = row && row.local_part ? row.local_part : shippedLocal;
    return {
        owner: row.owner,
        localPart: local,
        address: publicAddress(local),
        dept: row.dept || null,
        displayName: row.display_name || row.owner,
        enabled: !row.deleted_at && row.enabled !== 0,
        deleted: !!row.deleted_at,
        inboundEnabled: row.inbound_enabled !== 0,
        outboundEnabled: row.outbound_enabled !== 0,
        hasSignature: !!(row.signature_html && String(row.signature_html).trim()),
        hasKey: false,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function listMailboxRecords() {
    requireReady();
    const shipped = shippedMailboxes();
    const rows = getDb().prepare('SELECT * FROM exchange_mailbox').all();
    const byOwner = new Map(rows.map((row) => [row.owner, row]));
    const owners = new Set(Object.values(shipped));
    rows.forEach((row) => owners.add(row.owner));
    const keyRows = getDb().prepare(
        'SELECT mailbox FROM exchange_key WHERE revoked_at IS NULL'
    ).all();
    const keyed = new Set(keyRows.map((row) => row.mailbox));
    const out = [];
    for (const owner of owners) {
        const row = byOwner.get(owner);
        const shippedLocals = Object.keys(shipped).filter((local) => shipped[local] === owner);
        const shippedLocal = owner === HUMAN_OWNER && shipped[YUKIMI_LOCAL]
            ? YUKIMI_LOCAL
            : (owner === TSUBAME_OWNER && shipped[TSUBAME_LOCAL]
                ? TSUBAME_LOCAL
                : (shippedLocals[0] || null));
        if (row && row.deleted_at) {
            out.push(Object.assign(mailboxRowToView(row, shippedLocal), { hasKey: keyed.has(owner) }));
            continue;
        }
        if (row) {
            out.push(Object.assign(mailboxRowToView(row, shippedLocal || row.local_part), { hasKey: keyed.has(owner) }));
            continue;
        }
        if (!shippedLocal) continue;
        out.push({
            owner,
            localPart: shippedLocal,
            address: publicAddress(shippedLocal),
            dept: shippedLocal.includes('.') ? shippedLocal.split('.').slice(1).join('.') : null,
            displayName: owner === TSUBAME_OWNER ? 'Tsubame (Mailroom)' : owner,
            enabled: true,
            deleted: false,
            inboundEnabled: true,
            outboundEnabled: true,
            hasSignature: false,
            hasKey: keyed.has(owner),
            createdAt: null,
            updatedAt: null
        });
    }
    return out.sort((a, b) => a.owner.localeCompare(b.owner));
}

function getMailboxRecord(owner) {
    const wanted = canonicalizeAdmin(owner);
    return listMailboxRecords().find((row) => row.owner === wanted) || null;
}

function isActiveMailbox(owner) {
    const rec = getMailboxRecord(owner);
    return !!(rec && rec.enabled && !rec.deleted);
}

function listActiveOwners() {
    if (!isReady()) return [];
    return listMailboxRecords().filter((row) => row.enabled && !row.deleted).map((row) => row.owner);
}

function ensureMailboxRow(owner, extra) {
    requireReady();
    const rec = getMailboxRecord(owner);
    const now = nowIso();
    if (!rec) throw new MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
    const existing = getDb().prepare('SELECT owner FROM exchange_mailbox WHERE owner = ?').get(owner);
    const local = extra && extra.local_part ? extra.local_part : rec.localPart;
    if (existing) {
        const fields = extra || {};
        getDb().prepare(`
            UPDATE exchange_mailbox SET
                local_part = COALESCE(?, local_part),
                dept = COALESCE(?, dept),
                display_name = COALESCE(?, display_name),
                enabled = COALESCE(?, enabled),
                deleted_at = CASE WHEN ? = 'clear' THEN NULL ELSE COALESCE(?, deleted_at) END,
                inbound_enabled = COALESCE(?, inbound_enabled),
                outbound_enabled = COALESCE(?, outbound_enabled),
                signature_html = COALESCE(?, signature_html),
                updated_at = ?
            WHERE owner = ?
        `).run(
            fields.local_part || null,
            fields.dept || null,
            fields.display_name || null,
            typeof fields.enabled === 'number' ? fields.enabled : null,
            fields.deleted_at === null ? 'clear' : null,
            fields.deleted_at || null,
            typeof fields.inbound_enabled === 'number' ? fields.inbound_enabled : null,
            typeof fields.outbound_enabled === 'number' ? fields.outbound_enabled : null,
            Object.prototype.hasOwnProperty.call(fields, 'signature_html') ? fields.signature_html : null,
            now,
            owner
        );
        return;
    }
    getDb().prepare(`
        INSERT INTO exchange_mailbox (
            owner, local_part, dept, display_name, enabled, deleted_at,
            inbound_enabled, outbound_enabled, signature_html, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        owner,
        local,
        extra && extra.dept || rec.dept,
        extra && extra.display_name || rec.displayName,
        extra && typeof extra.enabled === 'number' ? extra.enabled : 1,
        extra && extra.deleted_at || null,
        extra && typeof extra.inbound_enabled === 'number' ? extra.inbound_enabled : 1,
        extra && typeof extra.outbound_enabled === 'number' ? extra.outbound_enabled : 1,
        extra && Object.prototype.hasOwnProperty.call(extra, 'signature_html') ? extra.signature_html : null,
        now,
        now
    );
}

function createMailbox(actor, { owner, dept, displayName, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'create_mailbox', owner);
    requireEnabled(admin, 'create_mailbox', owner);
    requireConfirm(confirm, 'create_mailbox');
    requireReady();
    const name = normalizeOwner(owner);
    if (!name || name.includes('@')) {
        audit(admin, 'create_mailbox', owner, false, 'invalid owner');
        throw new MailExchangeError('Mailbox owner must be a bare name, never an email', 'INVALID_OWNER');
    }
    if (getMailboxRecord(name) && !getMailboxRecord(name).deleted) {
        audit(admin, 'create_mailbox', name, false, 'exists');
        throw new MailExchangeError('Mailbox already exists', 'MAILBOX_EXISTS');
    }
    const local = localPartFor(name, dept);
    const bad = invalidLocalPart(local);
    if (bad) {
        audit(admin, 'create_mailbox', name, false, bad);
        throw new MailExchangeError(bad, 'INVALID_LOCAL');
    }
    const taken = listMailboxRecords().find((row) => row.localPart === local && row.owner !== name && !row.deleted);
    if (taken) {
        audit(admin, 'create_mailbox', name, false, 'local-part taken');
        throw new MailExchangeError(`Address ${publicAddress(local)} is already mapped`, 'LOCAL_TAKEN');
    }
    const deptValue = dept ? String(dept).trim().toLowerCase() : null;
    const label = displayName ? String(displayName).trim() : name;
    const now = nowIso();
    const existing = getDb().prepare('SELECT owner FROM exchange_mailbox WHERE owner = ?').get(name);
    if (existing) {
        getDb().prepare(`
            UPDATE exchange_mailbox SET
                local_part = ?, dept = ?, display_name = ?, enabled = 1, deleted_at = NULL, updated_at = ?
            WHERE owner = ?
        `).run(local, deptValue, label, now, name);
    } else {
        getDb().prepare(`
            INSERT INTO exchange_mailbox (
                owner, local_part, dept, display_name, enabled, deleted_at,
                inbound_enabled, outbound_enabled, signature_html, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 1, NULL, 1, 1, NULL, ?, ?)
        `).run(name, local, deptValue, label, now, now);
    }
    audit(admin, 'create_mailbox', name, true, `local=${local}`);
    return getMailboxRecord(name);
}

function disableMailbox(actor, { owner, enabled, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'disable_mailbox', owner);
    requireEnabled(admin, 'disable_mailbox', owner);
    requireConfirm(confirm, 'disable_mailbox');
    requireReady();
    const name = normalizeOwner(owner);
    const rec = getMailboxRecord(name);
    if (!rec || rec.deleted) {
        audit(admin, 'disable_mailbox', name, false, 'not found');
        throw new MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
    }
    const on = enabled !== false;
    ensureMailboxRow(name, { enabled: on ? 1 : 0 });
    audit(admin, 'disable_mailbox', name, true, `enabled=${on}`);
    return getMailboxRecord(name);
}

function deleteMailbox(actor, { owner, confirm, confirmText } = {}) {
    const admin = requireExchangeAdmin(actor, 'delete_mailbox', owner);
    requireEnabled(admin, 'delete_mailbox', owner);
    if (confirm !== true || String(confirmText || '') !== CONFIRM_DELETE) {
        throw new MailExchangeError(`Soft-delete requires confirm:true and confirmText:${CONFIRM_DELETE}`, 'CONFIRM_REQUIRED');
    }
    requireReady();
    const name = normalizeOwner(owner);
    if (name === HUMAN_OWNER) {
        audit(admin, 'delete_mailbox', name, false, 'cannot delete yukimi');
        throw new MailExchangeError("Cannot delete Yukimi's mailbox", 'FORBIDDEN');
    }
    const rec = getMailboxRecord(name);
    if (!rec) {
        audit(admin, 'delete_mailbox', name, false, 'not found');
        throw new MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
    }
    ensureMailboxRow(name, { enabled: 0, deleted_at: nowIso() });
    audit(admin, 'delete_mailbox', name, true, 'soft-deleted');
    return getMailboxRecord(name);
}

function issueMailboxKey(actor, { owner, confirm, rotate } = {}) {
    const action = rotate ? 'rotate_mailbox_key' : 'issue_mailbox_key';
    const admin = requireExchangeAdmin(actor, action, owner);
    requireEnabled(admin, action, owner);
    requireConfirm(confirm, action);
    requireReady();
    const name = normalizeOwner(owner);
    const rec = getMailboxRecord(name);
    if (!rec || rec.deleted) {
        audit(admin, action, name, false, 'not found');
        throw new MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
    }
    const existing = getDb().prepare('SELECT mailbox, revoked_at FROM exchange_key WHERE mailbox = ?').get(name);
    if (existing && !existing.revoked_at && !rotate) {
        audit(admin, action, name, false, 'already issued');
        throw new MailExchangeError('Mailbox already has a key; rotate to replace it', 'KEY_EXISTS');
    }
    const secret = generateMailboxKey();
    const hashed = hashKey(secret);
    const now = nowIso();
    getDb().prepare(`
        INSERT INTO exchange_key (mailbox, key_hash, created_at, revoked_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT(mailbox) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, revoked_at = NULL
    `).run(name, hashed, now);
    audit(admin, action, name, true, rotate ? 'rotated' : 'issued');
    return { owner: name, key: secret, keyHash: hashed, shownOnce: true };
}

function rotateMailboxKey(actor, opts) {
    return issueMailboxKey(actor, Object.assign({}, opts, { rotate: true }));
}

function revokeMailboxKey(actor, { owner, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'revoke_mailbox_key', owner);
    requireEnabled(admin, 'revoke_mailbox_key', owner);
    requireConfirm(confirm, 'revoke_mailbox_key');
    requireReady();
    const name = normalizeOwner(owner);
    const row = getDb().prepare('SELECT mailbox FROM exchange_key WHERE mailbox = ? AND revoked_at IS NULL').get(name);
    if (!row) {
        audit(admin, 'revoke_mailbox_key', name, false, 'not found');
        throw new MailExchangeError('No active key for this mailbox', 'KEY_NOT_FOUND');
    }
    getDb().prepare('UPDATE exchange_key SET revoked_at = ? WHERE mailbox = ?').run(nowIso(), name);
    audit(admin, 'revoke_mailbox_key', name, true, 'revoked');
    return { owner: name, revoked: true };
}

function verifyMailboxKey(owner, secret) {
    if (!isReady() || !secret) return false;
    const name = normalizeOwner(owner);
    const row = getDb().prepare(
        'SELECT key_hash FROM exchange_key WHERE mailbox = ? AND revoked_at IS NULL'
    ).get(name);
    if (!row) return false;
    const hashed = hashKey(secret);
    try {
        return crypto.timingSafeEqual(Buffer.from(row.key_hash, 'utf8'), Buffer.from(hashed, 'utf8'));
    } catch (_err) {
        return false;
    }
}

function storedAliases() {
    if (!isReady()) return {};
    const rows = getDb().prepare('SELECT local_part, target FROM exchange_alias').all();
    const map = Object.create(null);
    rows.forEach((row) => { map[row.local_part] = row.target; });
    return map;
}

function storedLists() {
    if (!isReady()) return {};
    const rows = getDb().prepare('SELECT local_part, name, members FROM exchange_list').all();
    const map = Object.create(null);
    rows.forEach((row) => {
        let members = [];
        try { members = JSON.parse(row.members); } catch (_err) { members = []; }
        map[row.local_part] = { name: row.name, members: Array.isArray(members) ? members : [] };
    });
    return map;
}

function overlayMailboxes() {
    const shipped = shippedMailboxes();
    if (!isReady()) return shipped;
    const rows = getDb().prepare('SELECT owner, local_part, enabled, deleted_at FROM exchange_mailbox').all();
    const table = Object.assign(Object.create(null), shipped);
    rows.forEach((row) => {
        if (row.deleted_at || row.enabled === 0) {
            Object.keys(table).forEach((local) => {
                if (table[local] === row.owner) delete table[local];
            });
            return;
        }
        table[row.local_part] = row.owner;
    });
    return table;
}

function getAddressOverlay() {
    const mailboxes = overlayMailboxes();
    YUKIMI_ALIASES.forEach((local) => {
        if (!mailboxes[local]) mailboxes[local] = HUMAN_OWNER;
    });
    if (!mailboxes[YUKIMI_LOCAL]) mailboxes[YUKIMI_LOCAL] = HUMAN_OWNER;
    if (!mailboxes[TSUBAME_LOCAL]) mailboxes[TSUBAME_LOCAL] = TSUBAME_OWNER;
    if (!mailboxes[MAILROOM_CATCHALL]) mailboxes[MAILROOM_CATCHALL] = TSUBAME_OWNER;
    const aliases = storedAliases();
    const lists = {};
    Object.entries(storedLists()).forEach(([local, info]) => {
        lists[local] = info.members.slice();
    });
    return { mailboxes, aliases, lists, domain: PUBLIC_DOMAIN };
}

function createLiveMapping() {
    return addresses.createMapping(getAddressOverlay());
}

function detectLoop(local, target, overlay) {
    const start = String(local || '').toLowerCase();
    let cursor = String(target || '').toLowerCase();
    const seen = new Set([start]);
    for (let i = 0; i < 32; i++) {
        if (!cursor) return false;
        if (seen.has(cursor)) return true;
        seen.add(cursor);
        if (overlay.mailboxes[cursor]) return false;
        if (Object.values(overlay.mailboxes).includes(cursor)) return false;
        if (overlay.lists[cursor]) {
            return overlay.lists[cursor].some((member) => detectLoop(start, member, overlay));
        }
        if (overlay.aliases[cursor]) {
            cursor = overlay.aliases[cursor];
            continue;
        }
        return false;
    }
    return true;
}

function upsertAlias(actor, { localPart, target, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'upsert_alias', localPart);
    requireEnabled(admin, 'upsert_alias', localPart);
    requireConfirm(confirm, 'upsert_alias');
    requireReady();
    const local = String(localPart || '').trim().toLowerCase();
    const dest = String(target || '').trim().toLowerCase();
    const bad = invalidLocalPart(local);
    if (bad) throw new MailExchangeError(bad, 'INVALID_LOCAL');
    if (!dest || dest.includes('@')) {
        throw new MailExchangeError('Alias target must be a mailbox or local-part on dream.737.jp.net', 'INVALID_TARGET');
    }
    const overlay = getAddressOverlay();
    if (overlay.mailboxes[local] || overlay.lists[local]) {
        throw new MailExchangeError('Local-part is already a mailbox or list', 'LOCAL_TAKEN');
    }
    if (detectLoop(local, dest, overlay)) {
        audit(admin, 'upsert_alias', local, false, 'loop');
        throw new MailExchangeError('Alias loop detected', 'ALIAS_LOOP');
    }
    getDb().prepare(`
        INSERT INTO exchange_alias (local_part, target, created_at) VALUES (?, ?, ?)
        ON CONFLICT(local_part) DO UPDATE SET target = excluded.target
    `).run(local, dest, nowIso());
    audit(admin, 'upsert_alias', local, true, `target=${dest}`);
    return { localPart: local, target: dest, address: publicAddress(local) };
}

function deleteAlias(actor, { localPart, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'delete_alias', localPart);
    requireEnabled(admin, 'delete_alias', localPart);
    requireConfirm(confirm, 'delete_alias');
    requireReady();
    const local = String(localPart || '').trim().toLowerCase();
    getDb().prepare('DELETE FROM exchange_alias WHERE local_part = ?').run(local);
    audit(admin, 'delete_alias', local, true, null);
    return { localPart: local, deleted: true };
}

function listAliases() {
    requireReady();
    const shipped = getAddressOverlay();
    const extra = Object.entries(storedAliases()).map(([localPart, target]) => ({
        localPart,
        target,
        address: publicAddress(localPart),
        kind: 'alias'
    }));
    const builtin = [];
    YUKIMI_ALIASES.forEach((local) => {
        builtin.push({
            localPart: local,
            target: HUMAN_OWNER,
            address: publicAddress(local),
            kind: 'builtin'
        });
    });
    builtin.push({
        localPart: MAILROOM_CATCHALL,
        target: TSUBAME_OWNER,
        address: publicAddress(MAILROOM_CATCHALL),
        kind: 'catchall',
        note: 'Catch-all to Tsubame (mailroom)'
    });
    return builtin.concat(extra).concat(
        Object.entries(shipped.lists || {}).map(([localPart, members]) => ({
            localPart,
            target: Array.isArray(members) ? members.join(',') : '',
            address: publicAddress(localPart),
            kind: 'list'
        }))
    );
}

function upsertDistributionList(actor, { localPart, name, members, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'upsert_list', localPart);
    requireEnabled(admin, 'upsert_list', localPart);
    requireConfirm(confirm, 'upsert_list');
    requireReady();
    const local = String(localPart || '').trim().toLowerCase();
    const bad = invalidLocalPart(local);
    if (bad) throw new MailExchangeError(bad, 'INVALID_LOCAL');
    const list = (Array.isArray(members) ? members : String(members || '').split(/[,\s]+/))
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean);
    if (!list.length) throw new MailExchangeError('Distribution list needs at least one member', 'EMPTY_LIST');
    if (list.some((item) => item.includes('@'))) {
        throw new MailExchangeError('List members must be mailbox names or local-parts, never external domains', 'INVALID_TARGET');
    }
    const overlay = getAddressOverlay();
    if (overlay.mailboxes[local] || overlay.aliases[local]) {
        throw new MailExchangeError('Local-part is already a mailbox or alias', 'LOCAL_TAKEN');
    }
    overlay.lists[local] = list;
    if (list.some((member) => detectLoop(local, member, overlay))) {
        audit(admin, 'upsert_list', local, false, 'loop');
        throw new MailExchangeError('Distribution list loop detected', 'ALIAS_LOOP');
    }
    const now = nowIso();
    getDb().prepare(`
        INSERT INTO exchange_list (local_part, name, members, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(local_part) DO UPDATE SET name = excluded.name, members = excluded.members, updated_at = excluded.updated_at
    `).run(local, name ? String(name).trim() : local, JSON.stringify(list), now, now);
    audit(admin, 'upsert_list', local, true, `members=${list.join(',')}`);
    return { localPart: local, name: name || local, members: list, address: publicAddress(local) };
}

function deleteDistributionList(actor, { localPart, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'delete_list', localPart);
    requireEnabled(admin, 'delete_list', localPart);
    requireConfirm(confirm, 'delete_list');
    requireReady();
    const local = String(localPart || '').trim().toLowerCase();
    getDb().prepare('DELETE FROM exchange_list WHERE local_part = ?').run(local);
    audit(admin, 'delete_list', local, true, null);
    return { localPart: local, deleted: true };
}

function listDistributionLists() {
    requireReady();
    return Object.entries(storedLists()).map(([localPart, info]) => ({
        localPart,
        name: info.name,
        members: info.members,
        address: publicAddress(localPart)
    }));
}

function sanitizeSignature(html) {
    const result = sanitizeHtml(String(html || ''), { allowRemoteImages: false });
    return { html: result.html, counts: result.counts };
}

function getSignature(owner) {
    requireReady();
    const name = normalizeOwner(owner);
    const row = getDb().prepare('SELECT signature_html FROM exchange_mailbox WHERE owner = ?').get(name);
    return {
        owner: name,
        html: row && row.signature_html ? row.signature_html : '',
        address: (getMailboxRecord(name) || {}).address || publicAddress(name)
    };
}

function setSignature(actor, { owner, html, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, 'set_signature', owner);
    requireEnabled(admin, 'set_signature', owner);
    requireConfirm(confirm, 'set_signature');
    requireReady();
    const name = normalizeOwner(owner);
    const rec = getMailboxRecord(name);
    if (!rec || rec.deleted) throw new MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
    const cleaned = sanitizeSignature(html);
    ensureMailboxRow(name, { signature_html: cleaned.html });
    audit(admin, 'set_signature', name, true, `bytes=${cleaned.html.length}`);
    return { owner: name, html: cleaned.html, counts: cleaned.counts };
}

function getSignatureHtml(owner) {
    if (!isReady()) return '';
    const row = getDb().prepare(
        'SELECT signature_html FROM exchange_mailbox WHERE owner = ? AND deleted_at IS NULL'
    ).get(normalizeOwner(owner));
    return row && row.signature_html ? row.signature_html : '';
}

function appendSignature(body, format, owner) {
    const html = getSignatureHtml(owner);
    if (!html) return String(body || '');
    const cleaned = sanitizeSignature(html).html;
    if (!cleaned) return String(body || '');
    const text = String(body || '');
    if (format === 'html') {
        if (text.includes(cleaned)) return text;
        return `${text}\n<div class="exchange-signature">${cleaned}</div>`;
    }
    const stripped = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stripped || text.includes(stripped)) return text;
    return `${text}\n\n-- \n${stripped}`;
}

function defaultToggles() {
    return {
        inbound: true,
        outbound: true,
        mailboxes: {},
        services: { yozora: { outbound: true } }
    };
}

function cloneToggleMap(map) {
    const out = {};
    Object.entries(map && typeof map === 'object' && !Array.isArray(map) ? map : {}).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = Object.assign({}, value);
    });
    return out;
}

function readToggles() {
    if (!isReady()) return defaultToggles();
    const row = getDb().prepare('SELECT value FROM exchange_setting WHERE key = ?').get('toggles');
    if (!row) return defaultToggles();
    try {
        const parsed = JSON.parse(row.value);
        const next = defaultToggles();
        if (typeof parsed.inbound === 'boolean') next.inbound = parsed.inbound;
        if (typeof parsed.outbound === 'boolean') next.outbound = parsed.outbound;
        if (parsed.mailboxes && typeof parsed.mailboxes === 'object' && !Array.isArray(parsed.mailboxes)) {
            next.mailboxes = cloneToggleMap(parsed.mailboxes);
        }
        if (parsed.services && typeof parsed.services === 'object' && !Array.isArray(parsed.services)) {
            next.services = cloneToggleMap(parsed.services);
        }
        return next;
    } catch (_err) {
        return defaultToggles();
    }
}

function writeToggles(next) {
    requireReady();
    getDb().prepare(`
        INSERT INTO exchange_setting (key, value) VALUES ('toggles', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(next));
}

function getToggles() {
    return readToggles();
}

function requireBoolField(value, field) {
    if (value === true || value === false) return value;
    throw new MailExchangeError(`${field} must be a boolean`, 'BAD_BODY');
}

function mergeNamedToggles(current, patch, kind) {
    if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new MailExchangeError(`${kind} must be an object`, 'BAD_BODY');
    }
    const next = cloneToggleMap(current);
    Object.entries(patch).forEach(([rawKey, value]) => {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) throw new MailExchangeError(`${kind} name is required`, 'BAD_BODY');
        if (value === null) {
            delete next[key];
            return;
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new MailExchangeError(`${kind} entry must be an object or null`, 'BAD_BODY');
        }
        const prev = next[key] ? Object.assign({}, next[key]) : {};
        if (Object.prototype.hasOwnProperty.call(value, 'inbound')) {
            prev.inbound = requireBoolField(value.inbound, 'inbound');
        }
        if (Object.prototype.hasOwnProperty.call(value, 'outbound')) {
            prev.outbound = requireBoolField(value.outbound, 'outbound');
        }
        next[key] = prev;
    });
    return next;
}

function pickRelayTogglePatch(patch) {
    const body = {};
    if (patch.inbound !== undefined) body.inbound = patch.inbound;
    if (patch.outbound !== undefined) body.outbound = patch.outbound;
    if (patch.mailboxes !== undefined) body.mailboxes = patch.mailboxes;
    if (patch.services !== undefined) body.services = patch.services;
    return body;
}

async function setToggles(actor, patch = {}) {
    const admin = requireExchangeAdmin(actor, 'set_toggles', 'global');
    requireEnabled(admin, 'set_toggles', 'global');
    requireConfirm(patch.confirm, 'set_toggles');
    const current = readToggles();
    const next = {
        inbound: current.inbound,
        outbound: current.outbound,
        mailboxes: cloneToggleMap(current.mailboxes),
        services: cloneToggleMap(current.services)
    };
    if (patch.inbound !== undefined) next.inbound = requireBoolField(patch.inbound, 'inbound');
    if (patch.outbound !== undefined) next.outbound = requireBoolField(patch.outbound, 'outbound');
    if (patch.mailboxes !== undefined) next.mailboxes = mergeNamedToggles(next.mailboxes, patch.mailboxes, 'mailboxes');
    if (patch.services !== undefined) next.services = mergeNamedToggles(next.services, patch.services, 'services');
    writeToggles(next);
    audit(admin, 'set_toggles', 'global', true, `inbound=${next.inbound} outbound=${next.outbound}`);
    let relayResult = { ok: false, skipped: true };
    if (patch.relay !== false) {
        const client = require('./lantisRelayClient');
        relayResult = await client.putToggles(pickRelayTogglePatch(patch), { actor: admin, confirm: true });
        if (!relayResult.ok) {
            audit(admin, 'set_toggles_relay', 'global', false, relayResult.code || 'degraded');
        } else if (relayResult.data && typeof relayResult.data === 'object') {
            return { toggles: next, relay: relayResult, relayToggles: relayResult.data };
        }
    }
    return { toggles: next, relay: relayResult };
}

function isInboundAllowed(owner) {
    if (!isEnabled()) return true;
    const toggles = readToggles();
    if (toggles.inbound === false) return false;
    const name = normalizeOwner(owner);
    const rec = isReady() ? getMailboxRecord(name) : null;
    if (rec) {
        if (rec.deleted || !rec.enabled) return false;
        if (rec.inboundEnabled === false) return false;
    }
    const box = toggles.mailboxes && toggles.mailboxes[name];
    if (box && box.inbound === false) return false;
    return true;
}

function isOutboundAllowed(owner, service) {
    if (!isEnabled()) return true;
    const toggles = readToggles();
    if (toggles.outbound === false) return false;
    if (service) {
        const svc = toggles.services && toggles.services[String(service).toLowerCase()];
        if (svc && svc.outbound === false) return false;
    }
    if (!owner) return true;
    const name = normalizeOwner(owner);
    const rec = isReady() ? getMailboxRecord(name) : null;
    if (rec) {
        if (rec.deleted || !rec.enabled) return false;
        if (rec.outboundEnabled === false) return false;
    }
    const box = toggles.mailboxes && toggles.mailboxes[name];
    if (box && box.outbound === false) return false;
    return true;
}

function inboundRejectReason(owner) {
    if (isInboundAllowed(owner)) return null;
    const name = normalizeOwner(owner);
    const toggles = readToggles();
    if (toggles.inbound === false) return 'External inbound is disabled';
    const rec = isReady() ? getMailboxRecord(name) : null;
    if (rec && (rec.deleted || !rec.enabled)) return 'Mailbox is disabled';
    return 'Inbound is disabled for this mailbox';
}

function outboundRejectReason(owner, service) {
    if (isOutboundAllowed(owner, service)) return null;
    const toggles = readToggles();
    if (toggles.outbound === false) return 'External outbound is disabled';
    if (service) {
        const svc = toggles.services && toggles.services[String(service).toLowerCase()];
        if (svc && svc.outbound === false) return `Outbound is disabled for service ${service}`;
    }
    return 'Outbound is disabled for this mailbox';
}

async function dashboard() {
    const client = require('./lantisRelayClient');
    const gateway = require('./mailGateway');
    const cfg = gateway.resolveConfig();
    const intake = {
        enabled: gateway.isEnabled(),
        listening: gateway.isListening(),
        bind: cfg.inbound.bind,
        port: cfg.inbound.port
    };
    const [status, queue, blocklists, rejects, senders, relayToggles] = await Promise.all([
        client.getStatus(),
        client.getQueue(),
        client.getBlocklists(),
        client.getRejects({ limit: 20 }),
        client.getSenders(),
        client.getToggles()
    ]);
    const dkim = status.ok && status.data && status.data.oci ? status.data.oci : { sender: null, dkim: 'unknown' };
    return {
        intake,
        localToggles: readToggles(),
        relay: {
            status,
            queue,
            blocklists,
            rejects,
            senders,
            toggles: relayToggles,
            dkim
        }
    };
}

function listSpamOverview(actor, { limit } = {}) {
    const admin = requireExchangeAdmin(actor, 'list_spam', 'spam');
    const dovecoteMail = require('./dovecoteMail');
    const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const isTsubame = canonicalizeAdmin(admin) === TSUBAME_OWNER;
    const boxes = listMailboxRecords().filter((row) => !row.deleted);
    const counts = [];
    const recent = [];
    boxes.forEach((box) => {
        if (!isTsubame && box.owner !== HUMAN_OWNER) return;
        if (isTsubame || box.owner === HUMAN_OWNER) {
            const mail = dovecoteMail.listMail(box.owner, { folder: 'spam', limit: cap });
            counts.push({
                owner: box.owner,
                address: box.address,
                count: mail.length,
                yukimiOnly: box.owner === HUMAN_OWNER
            });
            mail.forEach((item) => {
                recent.push({
                    mailbox: box.owner,
                    id: item.id,
                    from: item.from,
                    subject: item.subject,
                    createdAt: item.createdAt,
                    spamScore: item.spamScore,
                    rescueAllowed: isTsubame && box.owner !== HUMAN_OWNER
                });
            });
        }
    });
    recent.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
        counts,
        recent: recent.slice(0, cap),
        yukimiSpamOnly: true,
        tsubameRescue: isTsubame
    };
}

function rescueOrPurgeSpam(actor, { mailbox, id, spam, confirm } = {}) {
    const admin = requireExchangeAdmin(actor, spam ? 'purge_spam' : 'rescue_spam', id);
    requireConfirm(confirm, spam ? 'purge_spam' : 'rescue_spam');
    const dovecoteMail = require('./dovecoteMail');
    // Landed #344: Tsubame may rescue Yukimi Spam; Inbox → Spam on Yukimi is refused.
    return dovecoteMail.mailroomMoveMail(admin, { mailbox, id, spam: spam === true });
}

function publicMailboxView(row) {
    if (!row) return null;
    return {
        owner: row.owner,
        localPart: row.localPart,
        address: row.address,
        dept: row.dept,
        displayName: row.displayName,
        enabled: row.enabled,
        deleted: row.deleted,
        inboundEnabled: row.inboundEnabled,
        outboundEnabled: row.outboundEnabled,
        hasSignature: row.hasSignature,
        hasKey: row.hasKey
    };
}

module.exports = {
    MailExchangeError,
    HUMAN_OWNER,
    SALA_OWNER,
    MAILROOM_ROLE,
    TSUBAME_OWNER,
    TSUBAME_LOCAL,
    EXCHANGE_ADMINS,
    YUKIMI_LOCAL,
    YUKIMI_ALIASES,
    MAILROOM_CATCHALL,
    KEY_PREFIX,
    PUBLIC_DOMAIN,
    CONFIRM_DELETE,
    isEnabled,
    isExchangeAdmin,
    requireExchangeAdmin,
    canonicalizeAdmin,
    setTestConfig,
    resetTestConfig,
    audit,
    listAudit,
    listMailboxRecords,
    getMailboxRecord,
    listActiveOwners,
    isActiveMailbox,
    createMailbox,
    disableMailbox,
    deleteMailbox,
    issueMailboxKey,
    rotateMailboxKey,
    revokeMailboxKey,
    verifyMailboxKey,
    hashKey,
    getAddressOverlay,
    createLiveMapping,
    detectLoop,
    upsertAlias,
    deleteAlias,
    listAliases,
    upsertDistributionList,
    deleteDistributionList,
    listDistributionLists,
    sanitizeSignature,
    getSignature,
    setSignature,
    getSignatureHtml,
    appendSignature,
    getToggles,
    setToggles,
    isInboundAllowed,
    isOutboundAllowed,
    inboundRejectReason,
    outboundRejectReason,
    dashboard,
    listSpamOverview,
    rescueOrPurgeSpam,
    publicMailboxView,
    publicAddress
};
