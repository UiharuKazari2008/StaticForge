/**
 * Dovecote mail business logic. Every read/write is scoped to a single
 * mailbox owner resolved server-side from the caller's identity — callers
 * never supply the owner they want to act as. Non-own reads behave as if
 * the message does not exist (404-shaped: returns null).
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb, getAttachmentsRoot } = require('./dovecoteDatabase');
const addresses = require('./mailGatewayAddresses');
const { NULL_SENDER } = addresses;

const ROUTES = Object.freeze(['internal', 'inbound', 'outbound']);

function storedRoute(value) {
    return value === 'inbound' || value === 'outbound' ? value : 'internal';
}

const HUMAN_OWNER = 'yukimi';
const MAILROOM_OWNER = 'tsubame';
const MAILROOM_ROLE = 'mailroom';
// Seed / fallback only. Live owner checks read the Exchange DB (cached,
// invalidated on mailbox writes). Adding a bot is an Exchange admin action,
// not a code edit.
const BOT_OWNERS = addresses.SEED_BOT_OWNERS;
// Caller app names that are not bot names themselves but belong to a bot
// mailbox. Director chat (modules/cursorDirector.js app key "Dreamscape
// Director") runs as Wren, so it reads/sends as the 'wren' bot mailbox.
// Mailroom is the role name only. Only the Tsubame key carries it
// (and may read Yukimi's Spam). A key named Mailroom maps to nothing.
const ACTOR_ALIASES = Object.freeze({
    'dreamscape director': 'wren',
    dreamscapedirector: 'wren',
    director: 'wren'
});
const BOT_OWNER_SET = new Set(BOT_OWNERS);
const ALL_OWNERS = new Set([HUMAN_OWNER, ...BOT_OWNERS]);

let cachedOwners = null;
let cachedBotOwners = null;

function invalidateOwnerCache() {
    cachedOwners = null;
    cachedBotOwners = null;
}

function liveOwners() {
    if (cachedOwners) return cachedOwners;
    const set = new Set(ALL_OWNERS);
    extraOwners().forEach((owner) => set.add(owner));
    cachedOwners = set;
    return set;
}

function liveBotOwners() {
    if (cachedBotOwners) return cachedBotOwners;
    const set = new Set(BOT_OWNER_SET);
    extraOwners().forEach((owner) => {
        if (owner !== HUMAN_OWNER) set.add(owner);
    });
    cachedBotOwners = set;
    return set;
}

const FOLDERS = Object.freeze(['inbox', 'spam', 'outbox', 'sent', 'deleted', 'archive']);
const FORMATS = Object.freeze(['text', 'md', 'html']);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // per file
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024; // per message
const MAX_LIST = 200;
const DEFAULT_LIST = 50;
const MAX_BATCH_IDS = 200;

class DovecoteError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'DOVECOTE_ERROR';
    }
}

function extraOwners() {
    try {
        const exchange = require('./mailExchange');
        // modules/mailExchange.js isDirectoryReady / listDirectoryOwners
        if (!exchange.isDirectoryReady()) return [];
        return exchange.listDirectoryOwners();
    } catch (_err) {
        return [];
    }
}

function isValidOwner(owner) {
    if (typeof owner !== 'string') return false;
    return liveOwners().has(owner);
}

function isBotOwner(owner) {
    if (typeof owner !== 'string') return false;
    if (owner === HUMAN_OWNER) return false;
    return liveBotOwners().has(owner);
}

// One listener, set by the WS handler (modules/ws/handlers/250-dovecoteHandler.js).
// MCP and browser writes both land here, so a mailbox change pushes once.
let mailboxChangedListener = null;

function setMailboxChangedListener(listener) {
    mailboxChangedListener = typeof listener === 'function' ? listener : null;
}

function emitMailboxChanged(owners) {
    if (!mailboxChangedListener) return;
    const unique = [];
    (owners || []).forEach((owner) => {
        if (isValidOwner(owner) && !unique.includes(owner)) unique.push(owner);
    });
    if (!unique.length) return;
    try {
        mailboxChangedListener(unique);
    } catch (err) {
        console.error('Dovecote mailbox listener failed:', err.message);
    }
}

function emitMailDelivered(deliveries) {
    if (!Array.isArray(deliveries) || !deliveries.length) return;
    try {
        // notifyDeliveries: modules/dovecoteMailboxWebhook.js
        require('./dovecoteMailboxWebhook').notifyDeliveries(deliveries);
    } catch (err) {
        console.error('Dovecote mailbox webhook notify failed:', err.message);
    }
    try {
        // emitNewMail: modules/dovecoteMailboxEvents.js — notify-forward
        // consumes this stream (does not hook sendMail / deliverInboundMail).
        require('./dovecoteMailboxEvents').emitNewMail(deliveries);
    } catch (err) {
        console.error('Dovecote mailbox_new_mail emit failed:', err.message);
    }
}

function normalizeMailIds(id, ids) {
    const list = [];
    const seen = new Set();
    const push = (value) => {
        const text = String(value || '').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        list.push(text);
    };
    if (Array.isArray(ids)) ids.forEach(push);
    else if (ids) push(ids);
    if (id) push(id);
    if (list.length > MAX_BATCH_IDS) {
        throw new DovecoteError(`At most ${MAX_BATCH_IDS} message ids`, 'BATCH_TOO_LARGE');
    }
    return list;
}

function encodeListCursor(row) {
    return Buffer.from(`${row.created_at}\n${row.id}`, 'utf8').toString('base64url');
}

function decodeListCursor(cursor) {
    if (cursor == null || cursor === '') return null;
    try {
        const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
        const split = raw.indexOf('\n');
        if (split < 1) throw new Error('empty');
        const createdAt = raw.slice(0, split);
        const id = raw.slice(split + 1);
        if (!createdAt || !id) throw new Error('empty');
        return { createdAt, id };
    } catch (_err) {
        throw new DovecoteError('Invalid list cursor', 'INVALID_CURSOR');
    }
}

function listCap(limit) {
    return Math.max(1, Math.min(MAX_LIST, Number(limit) || DEFAULT_LIST));
}

function decorateMailList(mail, extra) {
    Object.keys(extra).forEach((key) => {
        Object.defineProperty(mail, key, { value: extra[key], enumerable: false });
    });
    return mail;
}

function listPageMeta(listed) {
    return {
        nextCursor: listed.nextCursor || null,
        hasMore: !!listed.hasMore,
        total: listed.total || 0,
        unread: listed.unread || 0
    };
}

function countOwnedMail(owner, { folder, unreadOnly } = {}) {
    let sql = `SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END), 0) AS unread
        FROM dovecote_message WHERE owner = ?`;
    const params = [owner];
    if (folder) {
        sql += ' AND folder = ?';
        params.push(String(folder));
    }
    if (unreadOnly) sql += ' AND read = 0';
    return getDb().prepare(sql).get(...params);
}

// Maps a resolved caller identity (bot name / Xi active runtime) to a mailbox
// owner. Never maps anything to the human mailbox — only send_mail/mark_mail/
// forward_mail reaching Yukimi's own mailbox go through the WS path, which
// hardcodes owner to 'yukimi' itself rather than calling this.
function resolveOwnerFromActor(actorName) {
    if (!actorName) return null;
    const lower = String(actorName).trim().toLowerCase().replace(/\s+/g, ' ');
    const bots = liveBotOwners();
    if (bots.has(lower)) return lower;
    const alias = ACTOR_ALIASES[lower] || ACTOR_ALIASES[lower.replace(/\s+/g, '')];
    return alias && bots.has(alias) ? alias : null;
}

function nowIso() {
    return new Date().toISOString();
}

function audit(actor, action, targetId, success, detail) {
    try {
        getDb().prepare(
            `INSERT INTO dovecote_audit_log (ts, actor, action, target_id, detail, success) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(nowIso(), String(actor || 'unknown'), action, targetId || null, detail ? String(detail).slice(0, 500) : null, success ? 1 : 0);
    } catch (err) {
        console.error('Dovecote audit log write failed:', err.message);
    }
}

function snippetOf(body) {
    const text = String(body || '').replace(/\s+/g, ' ').trim();
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function toSummary(row) {
    const spamMeta = spamMetaOf(row.spam_meta);
    return {
        id: row.id,
        owner: row.owner,
        folder: row.folder,
        archiveSubfolder: row.archive_subfolder || null,
        threadId: row.thread_id,
        from: row.from_owner,
        fromLabel: row.from_label || null,
        labelSuspicious: !!row.label_suspicious,
        route: storedRoute(row.route),
        external: storedRoute(row.route) !== 'internal',
        to: ownerList(row.to_list, row.to_owner),
        cc: ownerList(row.cc_list, null),
        subject: row.subject,
        snippet: snippetOf(row.body),
        format: row.format,
        read: !!row.read,
        flagged: !!row.flagged,
        fwdFromOwner: row.fwd_from_owner || null,
        readByRecipient: !!row.recipient_read_at,
        attachments: attachmentsMetaOf(row.attachments),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        spamScore: spamMeta.score,
        spamRequired: spamMeta.required,
        spamReport: spamMeta.report,
        spamReceivedSpf: spamMeta.receivedSpf,
        spamDkim: spamMeta.dkim,
        spamDmarc: spamMeta.dmarc,
        spamDmarcPolicy: spamMeta.dmarcP,
        spamForgedOurs: !!spamMeta.forgedOurs,
        originalTo: row.original_to || null,
        ownDomainFrom: !!row.own_domain_from
    };
}

function toFull(row) {
    return Object.assign(toSummary(row), { body: row.body, replyToId: row.reply_to_id || null });
}

function emptySpamMeta() {
    return {
        score: null, required: null, report: null,
        receivedSpf: null, dkim: null, dmarc: null, dmarcP: null, forgedOurs: false
    };
}

function spamMetaOf(json) {
    if (!json) return emptySpamMeta();
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object') return emptySpamMeta();
        return {
            score: Number.isFinite(parsed.score) ? parsed.score : null,
            required: Number.isFinite(parsed.required) ? parsed.required : null,
            report: parsed.report ? String(parsed.report) : null,
            receivedSpf: parsed.receivedSpf ? String(parsed.receivedSpf) : null,
            dkim: parsed.dkim ? String(parsed.dkim) : null,
            dmarc: parsed.dmarc ? String(parsed.dmarc) : null,
            dmarcP: parsed.dmarcP ? String(parsed.dmarcP) : null,
            forgedOurs: !!parsed.forgedOurs
        };
    } catch (_err) {
        return emptySpamMeta();
    }
}

function encodeSpamMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const out = {};
    if (Number.isFinite(meta.score)) out.score = meta.score;
    if (Number.isFinite(meta.required)) out.required = meta.required;
    if (meta.report) out.report = String(meta.report).slice(0, 16384);
    if (meta.status) out.status = String(meta.status);
    if (meta.flag) out.flag = String(meta.flag);
    if (meta.receivedSpf) out.receivedSpf = String(meta.receivedSpf);
    if (meta.dkim) out.dkim = String(meta.dkim);
    if (meta.dmarc) out.dmarc = String(meta.dmarc);
    if (meta.dmarcP) out.dmarcP = String(meta.dmarcP);
    if (meta.dmarcDis) out.dmarcDis = String(meta.dmarcDis);
    if (meta.forgedOurs) out.forgedOurs = true;
    return Object.keys(out).length ? JSON.stringify(out) : null;
}

function attachmentsMetaOf(json) {
    if (!json) return [];
    let ids;
    try {
        ids = JSON.parse(json);
    } catch (_err) {
        return [];
    }
    if (!Array.isArray(ids) || !ids.length) return [];
    const rows = getDb().prepare(
        `SELECT id, name, mime_type, size FROM dovecote_attachment WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
        const row = byId.get(id);
        return row ? { id: row.id, name: row.name, mimeType: row.mime_type, size: row.size } : null;
    }).filter(Boolean);
}

function insertRow(row) {
    getDb().prepare(`
        INSERT INTO dovecote_message (
            id, owner, folder, archive_subfolder, thread_id, from_owner, to_owner,
            to_list, cc_list, from_label, route, label_suspicious, spam_meta, original_to,
            own_domain_from,
            subject, body, format, reply_to_id, fwd_from_owner, fwd_from_message_id,
            read, flagged, created_at, updated_at, deleted_at, paired_message_id, attachments
        ) VALUES (
            @id, @owner, @folder, @archive_subfolder, @thread_id, @from_owner, @to_owner,
            @to_list, @cc_list, @from_label, @route, @label_suspicious, @spam_meta, @original_to,
            @own_domain_from,
            @subject, @body, @format, @reply_to_id, @fwd_from_owner, @fwd_from_message_id,
            @read, @flagged, @created_at, @updated_at, @deleted_at, @paired_message_id, @attachments
        )
    `).run(Object.assign({
        paired_message_id: null, attachments: null, to_list: null, cc_list: null,
        from_label: null, route: 'internal', label_suspicious: 0, spam_meta: null,
        original_to: null, own_domain_from: 0
    }, row));
}

// to_list / cc_list are JSON arrays. Rows from before multi-recipient mail
// leave them null and the single to_owner column is the whole To line.
function ownerList(json, fallbackOwner) {
    if (json == null || json === '') {
        return fallbackOwner ? [String(fallbackOwner)] : [];
    }
    try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
            return parsed.map((name) => String(name || '').trim()).filter(Boolean);
        }
    } catch (_err) {
        // Unreadable JSON falls back to the legacy single recipient.
    }
    return fallbackOwner ? [String(fallbackOwner)] : [];
}

function bareMailbox(token) {
    let name = String(token || '').trim().toLowerCase();
    const at = name.indexOf('@');
    if (at !== -1) name = name.slice(0, at);
    return name;
}

// `to` / `cc` accept a mailbox name, a comma/whitespace separated string, or an array of those.
function parseRecipients(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.flatMap(parseRecipients);
    if (typeof value !== 'string') {
        throw new DovecoteError('Recipient must be a mailbox name or a list of names', 'UNKNOWN_RECIPIENT');
    }
    return value.split(/[,;\s]+/).map(bareMailbox).filter(Boolean);
}

// To wins over Cc. A name in both is delivered once and stays on To.
function normalizeRecipients(to, cc) {
    const toList = [];
    const ccList = [];
    const seen = new Set();
    const take = (name, into) => {
        if (!name || seen.has(name)) return;
        if (!isValidOwner(name)) throw new DovecoteError(`Unknown recipient mailbox: ${name}`, 'UNKNOWN_RECIPIENT');
        seen.add(name);
        into.push(name);
    };
    for (const name of parseRecipients(to)) take(name, toList);
    for (const name of parseRecipients(cc)) take(name, ccList);
    if (!toList.length && !ccList.length) {
        throw new DovecoteError('At least one recipient is required', 'EMPTY_RECIPIENTS');
    }
    return { toList, ccList };
}

function classifySendRecipients(to, cc) {
    // modules/mailGateway.js — only when the gateway is enabled; otherwise
    // the existing mailbox-name path (normalizeRecipients) is unchanged.
    const mailGateway = require('./mailGateway');
    if (!mailGateway.isEnabled()) {
        return Object.assign({ externalTo: [], externalCc: [] }, normalizeRecipients(to, cc));
    }
    try {
        return mailGateway.classifyRecipients(to, cc);
    } catch (err) {
        throw new DovecoteError(err.message, err.code || 'UNKNOWN_RECIPIENT');
    }
}

function sanitizeFormat(format) {
    const value = String(format || 'text').trim().toLowerCase();
    return FORMATS.includes(value) ? value : 'text';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every id used as a path segment below is always a crypto.randomUUID() this
// module minted itself (message ids, attachment ids) — this is defense in
// depth, not the primary guard, in case a future caller feeds an id in
// without going through the owner-scoped lookups first.
function isUuidLike(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

function messageAttachmentDir(messageId) {
    return path.join(getAttachmentsRoot(), String(messageId));
}

function writeAttachmentFile(messageId, attachmentId, data) {
    if (!isUuidLike(messageId) || !isUuidLike(attachmentId)) return;
    const dir = messageAttachmentDir(messageId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, attachmentId), data);
}

function readAttachmentFile(messageId, attachmentId) {
    if (!isUuidLike(messageId) || !isUuidLike(attachmentId)) return null;
    const filePath = path.join(messageAttachmentDir(messageId), attachmentId);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
}

function sharedAttachmentFile(attachmentId) {
    return path.join(getAttachmentsRoot(), 'shared', attachmentId);
}

function writeSharedAttachment(attachmentId, data) {
    if (!isUuidLike(attachmentId)) return;
    const dir = path.join(getAttachmentsRoot(), 'shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, attachmentId), data);
}

function readAttachmentBytes(messageId, attachmentId) {
    if (!isUuidLike(attachmentId)) return null;
    const shared = sharedAttachmentFile(attachmentId);
    if (fs.existsSync(shared)) return fs.readFileSync(shared);
    return readAttachmentFile(messageId, attachmentId);
}

function copyAttachmentFile(fromMessageId, toMessageId, attachmentId) {
    const data = readAttachmentFile(fromMessageId, attachmentId);
    if (data === null) return;
    writeAttachmentFile(toMessageId, attachmentId, data);
}

function removeMessageAttachmentDir(messageId) {
    if (!isUuidLike(messageId)) return;
    fs.rmSync(messageAttachmentDir(messageId), { recursive: true, force: true });
}

// Legacy per-message files only. A send stores bytes once under shared/,
// and every copy of that send (and a forward of it) reads that one file.
// Forwarding an older row that has no shared blob still copies the file
// into the new message folder so the forward survives on its own.
function duplicateMessageAttachments(fromMessageId, toMessageId, attachmentsJson) {
    if (!attachmentsJson) return;
    let ids;
    try {
        ids = JSON.parse(attachmentsJson);
    } catch (_err) {
        return;
    }
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
        if (!isUuidLike(id)) continue;
        if (fs.existsSync(sharedAttachmentFile(id))) continue;
        copyAttachmentFile(fromMessageId, toMessageId, id);
    }
}

// Deletes an attachment's metadata row once no message references the id
// anymore. Called after a message is permanently deleted, since that message's
// own on-disk copy is already gone with its folder.
function cleanupOrphanedAttachmentMeta(attachmentsJson) {
    if (!attachmentsJson) return;
    let ids;
    try {
        ids = JSON.parse(attachmentsJson);
    } catch (_err) {
        return;
    }
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
        const stillReferenced = getDb().prepare(
            `SELECT id FROM dovecote_message WHERE attachments IS NOT NULL AND attachments LIKE ? LIMIT 1`
        ).get(`%"${id}"%`);
        if (!stillReferenced) {
            getDb().prepare('DELETE FROM dovecote_attachment WHERE id = ?').run(id);
            if (isUuidLike(id)) fs.rmSync(sharedAttachmentFile(id), { force: true });
        }
    }
}

/**
 * Stores attachment metadata in sqlite and the raw bytes once under
 * .cache/dovecote/attachments/shared/<attachmentId>. Every mailbox copy of
 * the send references the same id. Enforces per-file and total-per-message
 * size limits up front, so a send fails cleanly rather than partially
 * writing attachment files.
 */
function storeAttachments(attachments) {
    if (!attachments || !attachments.length) return null;
    let total = 0;
    for (const file of attachments) {
        const size = file.data ? file.data.length : 0;
        if (size > MAX_ATTACHMENT_BYTES) {
            throw new DovecoteError(`Attachment "${file.name || 'file'}" exceeds the ${MAX_ATTACHMENT_BYTES} byte per-file limit`, 'ATTACHMENT_TOO_LARGE');
        }
        total += size;
    }
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new DovecoteError(`Attachments total ${total} bytes, exceeding the ${MAX_TOTAL_ATTACHMENT_BYTES} byte per-message limit`, 'ATTACHMENTS_TOO_LARGE');
    }
    const createdAt = nowIso();
    const ids = attachments.map((file) => {
        const id = crypto.randomUUID();
        getDb().prepare(
            'INSERT INTO dovecote_attachment (id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(id, String(file.name || 'attachment').slice(0, 200), String(file.mimeType || 'application/octet-stream'), file.data.length, createdAt);
        writeSharedAttachment(id, file.data);
        return id;
    });
    return JSON.stringify(ids);
}

/**
 * Returns an attachment's bytes, scoped to an owner the same way mail reads
 * are: the owner must hold a message (any folder) whose attachments[]
 * includes this id, or this behaves as a 404 (returns null) rather than
 * leaking existence of the blob. Bytes are the one shared file for that id,
 * or a legacy per-message file when no shared blob exists.
 */
function getAttachment(owner, attachmentId) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const id = String(attachmentId || '');
    const holder = getDb().prepare(
        `SELECT id FROM dovecote_message WHERE owner = ? AND attachments IS NOT NULL AND attachments LIKE ? LIMIT 1`
    ).get(owner, `%"${id}"%`);
    if (!holder) {
        audit(owner, 'get_attachment', id, false, 'not found or not owned');
        return null;
    }
    const meta = getDb().prepare('SELECT id, name, mime_type, size FROM dovecote_attachment WHERE id = ?').get(id);
    if (!meta) return null;
    const data = readAttachmentBytes(holder.id, id);
    if (data === null) return null;
    audit(owner, 'get_attachment', id, true, null);
    return { id: meta.id, name: meta.name, mimeType: meta.mime_type, size: meta.size, data };
}

// fs.promises.readFile, with a missing file (or missing folder) as null like existsSync.
async function readFileOrNull(filePath) {
    try {
        return await fs.promises.readFile(filePath);
    } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
        throw err;
    }
}

async function readAttachmentBytesAsync(messageId, attachmentId) {
    if (!isUuidLike(attachmentId)) return null;
    const shared = await readFileOrNull(sharedAttachmentFile(attachmentId));
    if (shared !== null) return shared;
    if (!isUuidLike(messageId)) return null;
    return readFileOrNull(path.join(messageAttachmentDir(messageId), attachmentId));
}

/** getAttachment with the bytes read off the event loop (attachments run up to 10 MB). */
async function getAttachmentAsync(owner, attachmentId) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const id = String(attachmentId || '');
    const holder = getDb().prepare(
        `SELECT id FROM dovecote_message WHERE owner = ? AND attachments IS NOT NULL AND attachments LIKE ? LIMIT 1`
    ).get(owner, `%"${id}"%`);
    if (!holder) {
        audit(owner, 'get_attachment', id, false, 'not found or not owned');
        return null;
    }
    const meta = getDb().prepare('SELECT id, name, mime_type, size FROM dovecote_attachment WHERE id = ?').get(id);
    if (!meta) return null;
    const data = await readAttachmentBytesAsync(holder.id, id);
    if (data === null) return null;
    audit(owner, 'get_attachment', id, true, null);
    return { id: meta.id, name: meta.name, mimeType: meta.mime_type, size: meta.size, data };
}

// Posts a read receipt onto a message's paired sent copy, the first time only
// (sticky, like a real read receipt) — and only when a To recipient is the one
// reading. Cc does not stamp it. Without the To check, a sender marking their
// own already-read sent-folder copy "read" again would wrongly stamp
// recipient_read_at, as if a recipient had opened it.
function markPairedReadReceipt(owner, row) {
    if (!row || !row.paired_message_id) return null;
    const toList = ownerList(row.to_list, row.to_owner);
    if (!toList.includes(owner)) return null;
    const updated = getDb().prepare(
        `UPDATE dovecote_message SET recipient_read_at = ? WHERE id = ? AND recipient_read_at IS NULL RETURNING owner`
    ).get(nowIso(), row.paired_message_id);
    return updated ? updated.owner : null;
}

/**
 * fromOwner is always server-resolved. Bots/jobs may send to any mailbox,
 * including Yukimi's (Yukimi 2026-10-10); they still can never READ hers.
 * `to` and `cc` are a mailbox name, a separated string, or an array.
 * Each recipient gets one inbox copy. Every copy shares one threadId.
 * A name listed in both To and Cc is delivered once, on To.
 * attachments (optional): [{ name, mimeType, data: Buffer }], already resolved
 * to raw bytes by the caller (WS handler decodes base64, MCP facade resolves
 * VFS paths or base64) — this layer only enforces size limits and storage.
 * Attachment bytes are stored once and shared by every copy.
 */
function sendMail({ fromOwner, to, cc, subject, body, format, replyToId, attachments }) {
    if (!isValidOwner(fromOwner)) throw new DovecoteError('Unknown sender mailbox', 'UNKNOWN_SENDER');
    const { toList, ccList, externalTo, externalCc } = classifySendRecipients(to, cc);
    const delivered = toList.concat(ccList);
    const subjectText = String(subject || '').slice(0, 300);
    const bodyText = String(body || '');
    const formatValue = sanitizeFormat(format);
    const storedTo = toList.concat(externalTo || []);
    const storedCc = ccList.concat(externalCc || []);

    let threadId = crypto.randomUUID();
    let replyTo = null;
    if (replyToId) {
        const source = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(replyToId, fromOwner);
        if (source) {
            threadId = source.thread_id;
            replyTo = source.id;
        }
    }

    const createdAt = nowIso();
    const sentId = crypto.randomUUID();
    const inboxIds = delivered.map(() => crypto.randomUUID());
    const toJson = JSON.stringify(storedTo);
    const ccJson = JSON.stringify(storedCc);
    // to_owner stays a single name for the legacy column: the copy's own
    // recipient on inbox rows, and the first delivered name on the sent row.
    const primary = delivered[0] || (externalTo && externalTo[0]) || (externalCc && externalCc[0]);
    const hasExternal = (externalTo && externalTo.length) || (externalCc && externalCc.length);
    let attachmentsJson = null;
    const storedAttachments = () => {
        if (attachmentsJson === null) attachmentsJson = storeAttachments(attachments);
        return attachmentsJson;
    };

    const writeCopies = (folder) => {
        const sentFolder = folder === 'outbox' ? 'outbox' : 'sent';
        // Route is the path this write took, not anything in the headers.
        // Internal inbox copies never touched the relay even on a mixed send.
        const sentRoute = hasExternal ? 'outbound' : 'internal';
        const write = getDb().transaction(() => {
            insertRow({
                id: sentId, owner: fromOwner, folder: sentFolder, archive_subfolder: null, thread_id: threadId,
                from_owner: fromOwner, to_owner: primary, to_list: toJson, cc_list: ccJson,
                route: sentRoute, label_suspicious: 0,
                subject: subjectText, body: bodyText, format: formatValue,
                reply_to_id: replyTo, fwd_from_owner: null, fwd_from_message_id: null,
                read: 1, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
                paired_message_id: sentFolder === 'sent' ? (inboxIds[0] || null) : null,
                attachments: storedAttachments()
            });
            if (sentFolder !== 'sent') return;
            delivered.forEach((recipient, index) => {
                insertRow({
                    id: inboxIds[index], owner: recipient, folder: 'inbox', archive_subfolder: null, thread_id: threadId,
                    from_owner: fromOwner, to_owner: recipient, to_list: toJson, cc_list: ccJson,
                    route: 'internal', label_suspicious: 0,
                    subject: subjectText, body: bodyText, format: formatValue,
                    reply_to_id: replyTo, fwd_from_owner: null, fwd_from_message_id: null,
                    read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
                    paired_message_id: sentId, attachments: attachmentsJson
                });
            });
        });
        write();
    };

    const wrapOutboundError = (err) => {
        if (err instanceof DovecoteError) return err;
        return err && err.code
            ? new DovecoteError(err.message, err.code)
            : new DovecoteError(err.message || 'Outbound send failed', 'MAIL_GATEWAY_ERROR');
    };

    if (!hasExternal) {
        writeCopies('sent');
        audit(fromOwner, 'send_mail', sentId, true, `to=${storedTo.join(',')} cc=${storedCc.join(',')}`);
        emitMailboxChanged([fromOwner, ...delivered]);
        emitMailDelivered(delivered.map((owner, index) => ({
            mailbox: owner,
            id: inboxIds[index],
            from: fromOwner,
            subject: subjectText,
            receivedAt: createdAt
        })));
        return { id: sentId, threadId, to: storedTo, cc: storedCc };
    }

    const mailGateway = require('./mailGateway');
    const outbound = mailGateway.submitOutbound({
        fromOwner,
        to: externalTo,
        cc: externalCc,
        subject: subjectText,
        body: bodyText,
        format: formatValue
    }).then(() => {
        writeCopies('sent');
        audit(fromOwner, 'send_mail', sentId, true, `to=${storedTo.join(',')} cc=${storedCc.join(',')}`);
        emitMailboxChanged([fromOwner, ...delivered]);
        emitMailDelivered(delivered.map((owner, index) => ({
            mailbox: owner,
            id: inboxIds[index],
            from: fromOwner,
            subject: subjectText,
            receivedAt: createdAt
        })));
    }).catch((err) => {
        writeCopies('outbox');
        audit(fromOwner, 'send_mail', sentId, false, err.message);
        emitMailboxChanged([fromOwner]);
        throw wrapOutboundError(err);
    });
    return { id: sentId, threadId, to: storedTo, cc: storedCc, outbound };
}

/**
 * Inbound from the mail gateway. fromAddress is the envelope sender (a full
 * external email, or mailer-daemon for MAIL FROM:<> ) and is stored on
 * from_owner. fromLabel is the From header, display only — never a mailbox
 * owner. Writes inbox, or spam when the inbound path classified the
 * message as spam. Internal sendMail never calls this.
 */
function sanitizeOriginalTo(value) {
    const text = String(value || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 320);
    return text || null;
}

function deliverInboundMail({ fromAddress, fromLabel, toOwner, to, cc, subject, body, format, threadId, spam, spamMeta, originalTo, ownDomainFrom, trustedOwnSender, notifyLoop, headers }) {
    if (!isValidOwner(toOwner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const from = String(fromAddress || '').trim();
    if (!from || (from !== NULL_SENDER && !from.includes('@'))) {
        throw new DovecoteError('Sender address is required', 'UNKNOWN_SENDER');
    }
    if (isValidOwner(from)) {
        throw new DovecoteError('Inbound sender cannot be a Dovecote mailbox', 'UNKNOWN_SENDER');
    }
    const createdAt = nowIso();
    const id = crypto.randomUUID();
    const subjectText = String(subject || '').slice(0, 300);
    const bodyText = String(body || '');
    const toList = Array.isArray(to) && to.length ? to : [toOwner];
    const ccList = Array.isArray(cc) ? cc : [];
    const inspected = addresses.inspectFromLabel(fromLabel, {
        mapping: addresses.createMapping(),
        owners: Array.from(liveOwners())
    });
    // Own-domain labels (sala.ops@…, Yozora <yozora@…>) trip the protected-name
    // check by design. Mail the intake marked trustedOwnSender (aligned
    // own-domain envelope, not forged, no spam) is our own and not a spoof.
    const forged = !!(spamMeta && spamMeta.forgedOurs);
    if (inspected.suspicious && trustedOwnSender === true && ownDomainFrom && spam !== true && !forged) {
        inspected.suspicious = false;
    }
    const storedLabel = inspected.suspicious ? from : (inspected.label || '').slice(0, 300);
    const folder = spam === true ? 'spam' : 'inbox';
    const storedSpamMeta = encodeSpamMeta(spamMeta);
    const displaySpam = spamMetaOf(storedSpamMeta);
    const storedOriginalTo = sanitizeOriginalTo(originalTo);
    insertRow({
        id, owner: toOwner, folder, archive_subfolder: null,
        thread_id: threadId || crypto.randomUUID(),
        from_owner: from, to_owner: toOwner,
        to_list: JSON.stringify(toList), cc_list: JSON.stringify(ccList),
        from_label: storedLabel || null,
        route: 'inbound',
        label_suspicious: inspected.suspicious ? 1 : 0,
        spam_meta: storedSpamMeta,
        original_to: storedOriginalTo,
        own_domain_from: ownDomainFrom ? 1 : 0,
        subject: subjectText, body: bodyText, format: sanitizeFormat(format),
        reply_to_id: null, fwd_from_owner: null, fwd_from_message_id: null,
        read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
        paired_message_id: null, attachments: null
    });
    audit(toOwner, 'receive_external_mail', id, true, `from=${from}`);
    emitMailboxChanged([toOwner]);
    if (folder === 'inbox') {
        emitMailDelivered([{
            mailbox: toOwner,
            id,
            from,
            subject: subjectText,
            receivedAt: createdAt,
            notifyLoop: notifyLoop === true,
            headers: headers || null
        }]);
    }
    return {
        id, owner: toOwner, from,
        fromLabel: storedLabel || null,
        labelSuspicious: inspected.suspicious,
        route: 'inbound',
        external: true,
        folder,
        spamScore: displaySpam.score,
        spamRequired: displaySpam.required,
        spamReport: displaySpam.report,
        spamReceivedSpf: displaySpam.receivedSpf,
        spamDkim: displaySpam.dkim,
        spamDmarc: displaySpam.dmarc,
        spamDmarcPolicy: displaySpam.dmarcP,
        spamForgedOurs: !!displaySpam.forgedOurs,
        originalTo: storedOriginalTo,
        ownDomainFrom: !!ownDomainFrom
    };
}

function listMail(owner, { folder, unreadOnly, limit, cursor, silent } = {}) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const cap = listCap(limit);
    const after = cursor ? decodeListCursor(cursor) : null;
    let sql = 'SELECT * FROM dovecote_message WHERE owner = ?';
    const params = [owner];
    if (folder) {
        sql += ' AND folder = ?';
        params.push(String(folder));
    }
    if (unreadOnly) sql += ' AND read = 0';
    if (after) {
        sql += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
        params.push(after.createdAt, after.createdAt, after.id);
    }
    sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
    params.push(cap + 1);
    const rows = getDb().prepare(sql).all(...params);
    const hasMore = rows.length > cap;
    if (hasMore) rows.pop();
    const counts = countOwnedMail(owner, { folder, unreadOnly });
    if (silent !== true) {
        audit(owner, 'list_mail', null, true, `folder=${folder || 'all'} count=${rows.length} total=${counts.total}`);
    }
    const mail = rows.map(toSummary);
    // Mailbox owner of the caller. Non-enumerable so the value stays an array
    // for existing callers; list_mail copies it onto the result even when mail is empty.
    return decorateMailList(mail, {
        owner,
        nextCursor: hasMore && rows.length ? encodeListCursor(rows[rows.length - 1]) : null,
        hasMore,
        total: counts.total,
        unread: unreadOnly ? counts.total : counts.unread
    });
}

/** Returns null (never throws) when the message does not exist or is not owned by `owner` — callers should treat that as a 404. */
function readMail(owner, id, { markRead } = {}) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const row = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) {
        audit(owner, 'read_mail', id, false, 'not found or not owned');
        return null;
    }
    if (!row.read && markRead !== false) {
        getDb().prepare('UPDATE dovecote_message SET read = 1, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
        row.read = 1;
        const receiptOwner = markPairedReadReceipt(owner, row);
        emitMailboxChanged([owner, receiptOwner]);
    }
    audit(owner, 'read_mail', id, true, null);
    return toFull(row);
}

function markMail(owner, { id, read, archived, deleted, archiveSubfolder, spam, silent, changedOwners }) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const row = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) {
        audit(owner, 'mark_mail', id, false, 'not found or not owned');
        return null;
    }
    // Deleting a message that is already in the 'deleted' folder permanently
    // removes it (and its attachments) — same as hitting Delete on a Trash
    // item in a real mail client, rather than soft-deleting it again.
    if (deleted === true && row.folder === 'deleted') {
        return permanentlyDeleteMail(owner, id, { silent });
    }
    const updates = { updated_at: nowIso() };
    if (typeof read === 'boolean') updates.read = read ? 1 : 0;
    const receiptOwner = read === true ? markPairedReadReceipt(owner, row) : null;
    if (deleted === true) {
        updates.folder = 'deleted';
        updates.deleted_at = nowIso();
    } else if (archived === true) {
        updates.folder = 'archive';
        updates.archive_subfolder = archiveSubfolder ? String(archiveSubfolder).slice(0, 80) : null;
    } else if (spam === true) {
        updates.folder = 'spam';
        updates.archive_subfolder = null;
        updates.deleted_at = null;
    } else if (archived === false || deleted === false || spam === false) {
        updates.folder = 'inbox';
        updates.archive_subfolder = null;
        updates.deleted_at = null;
    }
    const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    getDb().prepare(`UPDATE dovecote_message SET ${sets} WHERE id = ?`).run(...values, row.id);
    audit(owner, 'mark_mail', id, true, JSON.stringify(updates));
    if (!silent) emitMailboxChanged([owner, receiptOwner]);
    else if (receiptOwner && changedOwners instanceof Set) changedOwners.add(receiptOwner);
    const updated = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ?').get(row.id);
    return toSummary(updated);
}

function countMailInFolder(owner, ids, folder) {
    const list = normalizeMailIds(null, ids);
    if (!list.length) return 0;
    const marks = list.map(() => '?').join(',');
    return getDb().prepare(
        `SELECT COUNT(*) AS n FROM dovecote_message WHERE owner = ? AND folder = ? AND id IN (${marks})`
    ).get(owner, String(folder), ...list).n;
}

function markMailBatch(owner, { id, ids, read, archived, deleted, archiveSubfolder, spam }) {
    const list = normalizeMailIds(id, ids);
    if (!list.length) throw new DovecoteError('Message id is required', 'MESSAGE_ID_REQUIRED');
    const mail = [];
    const missing = [];
    // Paired read-receipt senders must refresh too (single markMail emits them).
    const changedOwners = new Set([owner]);
    const apply = getDb().transaction(() => {
        list.forEach((one) => {
            const row = markMail(owner, {
                id: one, read, archived, deleted, archiveSubfolder, spam, silent: true, changedOwners
            });
            if (row) mail.push(row);
            else missing.push(one);
        });
    });
    apply();
    emitMailboxChanged(Array.from(changedOwners));
    return { mail, missing, updated: mail.length };
}

/**
 * Forwarding writes a brand-new row (new thread_id) into the target mailbox.
 * It is a copy, not a share — the recipient never gains access to the
 * source thread or mailbox.
 */
function resolveForwardTarget(to) {
    const raw = String(to || '').trim();
    if (!raw) throw new DovecoteError('Unknown recipient mailbox: (empty)', 'UNKNOWN_RECIPIENT');
    const bare = raw.toLowerCase();
    if (isValidOwner(bare)) return bare;
    const mailGateway = require('./mailGateway');
    const mapping = mailGateway.resolveConfig().mapping;
    const classified = addresses.classifyRecipient(raw, {
        mapping,
        enabled: mailGateway.isEnabled(),
        isValidOwner
    });
    if (classified && classified.kind === 'internal') return classified.owner;
    if (classified && classified.kind === 'external') {
        throw new DovecoteError(
            'Cannot forward to an external address (would leave the local mailbox)',
            'LOCAL_ONLY'
        );
    }
    throw new DovecoteError(`Unknown recipient mailbox: ${to}`, 'UNKNOWN_RECIPIENT');
}

function forwardMail(owner, { id, to, silent }) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const toOwner = resolveForwardTarget(to);
    const source = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(id, owner);
    if (!source) {
        audit(owner, 'forward_mail', id, false, 'not found or not owned');
        return null;
    }
    const createdAt = nowIso();
    const newId = crypto.randomUUID();
    insertRow({
        id: newId, owner: toOwner, folder: 'inbox', archive_subfolder: null, thread_id: crypto.randomUUID(),
        from_owner: source.from_owner, to_owner: toOwner, subject: `Fwd: ${source.subject}`, body: source.body,
        format: source.format, reply_to_id: null, fwd_from_owner: owner, fwd_from_message_id: source.id,
        // A forwarded gateway message still came from outside; never show it as internal.
        route: storedRoute(source.route) === 'internal' ? 'internal' : 'inbound',
        from_label: source.from_label || null,
        label_suspicious: source.label_suspicious ? 1 : 0,
        spam_meta: source.spam_meta || null,
        original_to: source.original_to || null,
        own_domain_from: source.own_domain_from ? 1 : 0,
        read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
        attachments: source.attachments || null
    });
    // The forwarded row references the same attachment ids as the source, but
    // needs its own on-disk copy so deleting either message independently
    // never takes the other's attachments with it.
    duplicateMessageAttachments(source.id, newId, source.attachments);
    audit(owner, 'forward_mail', newId, true, `to=${toOwner} source=${id}`);
    emitMailDelivered([{
        mailbox: toOwner,
        id: newId,
        from: source.from_owner,
        subject: `Fwd: ${source.subject}`,
        receivedAt: createdAt
    }]);
    if (!silent) emitMailboxChanged([toOwner]);
    return { id: newId, to: toOwner, sourceId: id };
}

function forwardMailBatch(owner, { id, ids, to }) {
    const list = normalizeMailIds(id, ids);
    if (!list.length) throw new DovecoteError('Message id is required', 'MESSAGE_ID_REQUIRED');
    const forwarded = [];
    const missing = [];
    let toOwner = null;
    const apply = getDb().transaction(() => {
        list.forEach((one) => {
            const row = forwardMail(owner, { id: one, to, silent: true });
            if (row) {
                forwarded.push(row);
                toOwner = row.to;
            } else missing.push(one);
        });
    });
    apply();
    if (toOwner) emitMailboxChanged([toOwner]);
    return { forwarded, missing, updated: forwarded.length, to: toOwner };
}

function isMailroomActor(actor) {
    return actor === MAILROOM_OWNER;
}

function mailroomAudit(actor, action, { mailbox, id, success, extra } = {}) {
    const parts = [];
    if (mailbox) parts.push(`mailbox=${mailbox}`);
    if (extra) parts.push(String(extra));
    audit(actor || 'unknown', action, id || null, success, parts.join(' ') || null);
}

function requireMailroomRole(actor, action, { mailbox, id } = {}) {
    if (isMailroomActor(actor)) return;
    mailroomAudit(actor, action, { mailbox, id, success: false, extra: 'mailroom role required' });
    throw new DovecoteError('Mailroom role required', 'FORBIDDEN');
}

function resolveMailroomTarget(mailbox, actor, action, id) {
    const target = String(mailbox || '').trim().toLowerCase();
    if (!isValidOwner(target)) {
        if (action) {
            mailroomAudit(actor, action, {
                mailbox: target.slice(0, 64) || '(none)', id, success: false, extra: 'unknown mailbox'
            });
        }
        throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    }
    return target;
}

/** Facade-level denial (caller is not Tsubame): audit it like every other mailroom op. */
function auditMailroomDenied(actor, action, { mailbox, id } = {}) {
    mailroomAudit(actor || 'unknown', action, {
        mailbox: mailbox ? String(mailbox).slice(0, 64) : null, id, success: false, extra: 'mailroom role required'
    });
}

/**
 * Mailroom-only: forward a message from Tsubame's mailbox to another
 * internal mailbox. Reuses forwardMail so route / fromLabel / flags copy.
 */
function mailroomForwardMail(actor, { id, to }) {
    requireMailroomRole(actor, 'mailroom_forward_mail', { mailbox: MAILROOM_OWNER, id });
    const result = forwardMail(MAILROOM_OWNER, { id, to });
    if (!result) {
        mailroomAudit(actor, 'mailroom_forward_mail', {
            mailbox: MAILROOM_OWNER, id, success: false, extra: 'not found or not owned'
        });
        return null;
    }
    mailroomAudit(actor, 'mailroom_forward_mail', {
        mailbox: MAILROOM_OWNER, id: result.id, success: true, extra: `to=${result.to} source=${id}`
    });
    return result;
}

/**
 * Mailroom-only: move Inbox ↔ Spam on another bot mailbox, or rescue
 * Spam → Inbox on any mailbox including Yukimi. Yukimi is Spam-only:
 * no Inbox read and no Inbox → Spam.
 */
function mailroomMoveMail(actor, { mailbox, id, spam }) {
    const action = spam === false ? 'mailroom_rescue_mail' : 'mailroom_move_mail';
    requireMailroomRole(actor, action, { mailbox, id });
    const target = resolveMailroomTarget(mailbox, actor, action, id);
    if (typeof spam !== 'boolean') {
        throw new DovecoteError('spam true or false is required', 'INVALID_FOLDER');
    }
    if (target === HUMAN_OWNER && spam === true) {
        mailroomAudit(actor, action, { mailbox: target, id, success: false, extra: 'refused: yukimi inbox-to-spam' });
        throw new DovecoteError("Cannot move mail into Yukimi's Spam", 'FORBIDDEN');
    }
    const row = getDb().prepare(
        'SELECT id, owner, folder FROM dovecote_message WHERE id = ? AND owner = ?'
    ).get(id, target);
    if (!row) {
        mailroomAudit(actor, action, { mailbox: target, id, success: false, extra: 'not found' });
        return null;
    }
    if (target === HUMAN_OWNER && row.folder !== 'spam') {
        mailroomAudit(actor, action, {
            mailbox: target, id, success: false, extra: `folder=${row.folder} refused: yukimi spam-only`
        });
        throw new DovecoteError("Yukimi access is Spam-folder only", 'FORBIDDEN');
    }
    if (row.folder !== 'inbox' && row.folder !== 'spam') {
        mailroomAudit(actor, action, { mailbox: target, id, success: false, extra: `folder=${row.folder}` });
        throw new DovecoteError('Can only move Inbox or Spam', 'INVALID_FOLDER');
    }
    const folder = spam ? 'spam' : 'inbox';
    getDb().prepare(
        'UPDATE dovecote_message SET folder = ?, archive_subfolder = NULL, deleted_at = NULL, updated_at = ? WHERE id = ? AND owner = ?'
    ).run(folder, nowIso(), row.id, target);
    mailroomAudit(actor, action, {
        mailbox: target, id, success: true, extra: `from=${row.folder} to=${folder}`
    });
    emitMailboxChanged([target]);
    return { id: row.id, mailbox: target, folder };
}

/**
 * Mailroom-only: list another mailbox's Spam folder. Every mailbox including
 * Yukimi. Other folders are refused.
 */
function mailroomListMail(actor, { mailbox, folder, unreadOnly, limit, cursor } = {}) {
    requireMailroomRole(actor, 'mailroom_list_mail', { mailbox });
    const target = resolveMailroomTarget(mailbox, actor, 'mailroom_list_mail', undefined);
    const wantFolder = String(folder || 'spam').toLowerCase();
    if (wantFolder !== 'spam') {
        mailroomAudit(actor, 'mailroom_list_mail', {
            mailbox: target, success: false, extra: `folder=${wantFolder} refused`
        });
        throw new DovecoteError('Cross-mailbox list is Spam-folder only', 'FORBIDDEN');
    }
    const listed = listMail(target, { folder: 'spam', unreadOnly, limit, cursor });
    mailroomAudit(actor, 'mailroom_list_mail', {
        mailbox: target, success: true, extra: `folder=spam count=${listed.length} total=${listed.total}`
    });
    return listed;
}

/**
 * Mailroom-only: read one Spam message in another mailbox (including Yukimi).
 * Does not flip the owner's read flag. Inbox and every other folder 403.
 */
function mailroomReadMail(actor, { mailbox, id }) {
    requireMailroomRole(actor, 'mailroom_read_mail', { mailbox, id });
    const target = resolveMailroomTarget(mailbox, actor, 'mailroom_read_mail', id);
    const row = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(id, target);
    if (!row) {
        mailroomAudit(actor, 'mailroom_read_mail', { mailbox: target, id, success: false, extra: 'not found' });
        return null;
    }
    if (row.folder !== 'spam') {
        mailroomAudit(actor, 'mailroom_read_mail', {
            mailbox: target, id, success: false, extra: `folder=${row.folder} refused`
        });
        throw new DovecoteError(
            target === HUMAN_OWNER ? "Yukimi access is Spam-folder only" : 'Cross-mailbox read is Spam-folder only',
            'FORBIDDEN'
        );
    }
    mailroomAudit(actor, 'mailroom_read_mail', { mailbox: target, id, success: true, extra: 'folder=spam' });
    return toFull(row);
}

/**
 * Mailroom-only: soft-purge a Spam message in any mailbox (including Yukimi)
 * into the deleted/trash folder. Not a hard delete.
 */
function mailroomPurgeMail(actor, { mailbox, id }) {
    requireMailroomRole(actor, 'mailroom_purge_mail', { mailbox, id });
    const target = resolveMailroomTarget(mailbox, actor, 'mailroom_purge_mail', id);
    const row = getDb().prepare(
        'SELECT id, owner, folder FROM dovecote_message WHERE id = ? AND owner = ?'
    ).get(id, target);
    if (!row) {
        mailroomAudit(actor, 'mailroom_purge_mail', { mailbox: target, id, success: false, extra: 'not found' });
        return null;
    }
    if (row.folder !== 'spam') {
        mailroomAudit(actor, 'mailroom_purge_mail', {
            mailbox: target, id, success: false, extra: `folder=${row.folder} refused`
        });
        throw new DovecoteError('Can only purge Spam', 'FORBIDDEN');
    }
    const deletedAt = nowIso();
    getDb().prepare(
        'UPDATE dovecote_message SET folder = ?, archive_subfolder = NULL, deleted_at = ?, updated_at = ? WHERE id = ? AND owner = ?'
    ).run('deleted', deletedAt, deletedAt, row.id, target);
    mailroomAudit(actor, 'mailroom_purge_mail', {
        mailbox: target, id, success: true, extra: 'folder=spam purge=soft'
    });
    emitMailboxChanged([target]);
    return { id: row.id, mailbox: target, folder: 'deleted', purged: true };
}

/**
 * Hard-deletes a message row and its on-disk attachment folder. Unlike
 * markMail's soft delete (which just moves the row into the 'deleted'
 * folder), this cannot be undone — callers trigger it by deleting a message
 * that is already in the 'deleted' folder (see markMail), matching a mail
 * client's "delete from Trash" convention.
 */
function permanentlyDeleteMail(owner, id, { silent } = {}) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const row = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) {
        audit(owner, 'permanently_delete_mail', id, false, 'not found or not owned');
        return null;
    }
    getDb().prepare('DELETE FROM dovecote_message WHERE id = ?').run(row.id);
    removeMessageAttachmentDir(row.id);
    cleanupOrphanedAttachmentMeta(row.attachments);
    audit(owner, 'permanently_delete_mail', id, true, null);
    if (!silent) emitMailboxChanged([owner]);
    return { id: row.id, permanentlyDeleted: true };
}

function getAlwaysLoadSenders(owner) {
    const rows = getDb().prepare(
        'SELECT sender FROM dovecote_image_pref WHERE owner = ? AND always_load = 1'
    ).all(owner);
    return new Set(rows.map((row) => row.sender));
}

function setImagePref(owner, sender, alwaysLoad) {
    getDb().prepare(`
        INSERT INTO dovecote_image_pref (owner, sender, always_load) VALUES (?, ?, ?)
        ON CONFLICT(owner, sender) DO UPDATE SET always_load = excluded.always_load
    `).run(owner, String(sender || '').toLowerCase(), alwaysLoad ? 1 : 0);
}

function listMailboxes() {
    const counts = getDb().prepare(
        `SELECT owner, folder, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread
         FROM dovecote_message WHERE folder IN ('inbox', 'spam') GROUP BY owner, folder`
    ).all();
    const inboxByOwner = new Map();
    const spamByOwner = new Map();
    counts.forEach((row) => {
        if (row.folder === 'spam') spamByOwner.set(row.owner, row.unread);
        else inboxByOwner.set(row.owner, row.unread);
    });
    const owners = Array.from(liveOwners());
    return owners.map((owner) => ({
        owner,
        unread: inboxByOwner.get(owner) || 0,
        spamUnread: spamByOwner.get(owner) || 0
    }));
}

module.exports = {
    HUMAN_OWNER,
    MAILROOM_OWNER,
    MAILROOM_ROLE,
    BOT_OWNERS,
    invalidateOwnerCache,
    FOLDERS,
    FORMATS,
    ROUTES,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    MAX_LIST,
    DEFAULT_LIST,
    MAX_BATCH_IDS,
    DovecoteError,
    normalizeMailIds,
    listPageMeta,
    isValidOwner,
    isBotOwner,
    isMailroomActor,
    resolveOwnerFromActor,
    setMailboxChangedListener,
    sendMail,
    deliverInboundMail,
    listMail,
    readMail,
    markMail,
    markMailBatch,
    countMailInFolder,
    forwardMail,
    forwardMailBatch,
    mailroomForwardMail,
    auditMailroomDenied,
    mailroomMoveMail,
    mailroomListMail,
    mailroomReadMail,
    mailroomPurgeMail,
    permanentlyDeleteMail,
    listMailboxes,
    getAlwaysLoadSenders,
    setImagePref,
    getAttachment,
    getAttachmentAsync,
    audit
};
