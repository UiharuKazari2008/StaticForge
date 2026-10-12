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

const HUMAN_OWNER = 'yukimi';
const BOT_OWNERS = Object.freeze([
    'rook', 'menma', 'hoshino', 'ivory', 'guren', 'chiyo', 'frost', 'sala', 'tifa', 'pyra', 'cursor', 'claude', 'wren'
]);
// Caller app names that are not bot names themselves but belong to a bot
// mailbox. Director chat (modules/cursorDirector.js app key "Dreamscape
// Director") runs as Wren, so it reads/sends as the 'wren' bot mailbox.
const ACTOR_ALIASES = Object.freeze({
    'dreamscape director': 'wren',
    dreamscapedirector: 'wren',
    director: 'wren'
});
const BOT_OWNER_SET = new Set(BOT_OWNERS);
const ALL_OWNERS = new Set([HUMAN_OWNER, ...BOT_OWNERS]);

const FOLDERS = Object.freeze(['inbox', 'outbox', 'sent', 'deleted', 'archive']);
const FORMATS = Object.freeze(['text', 'md', 'html']);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // per file
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024; // per message

class DovecoteError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'DOVECOTE_ERROR';
    }
}

function isValidOwner(owner) {
    return typeof owner === 'string' && ALL_OWNERS.has(owner);
}

function isBotOwner(owner) {
    return typeof owner === 'string' && BOT_OWNER_SET.has(owner);
}

// Maps a resolved caller identity (bot name / Xi active runtime) to a mailbox
// owner. Never maps anything to the human mailbox — only send_mail/mark_mail/
// forward_mail reaching Yukimi's own mailbox go through the WS path, which
// hardcodes owner to 'yukimi' itself rather than calling this.
function resolveOwnerFromActor(actorName) {
    if (!actorName) return null;
    const lower = String(actorName).trim().toLowerCase().replace(/\s+/g, ' ');
    if (BOT_OWNER_SET.has(lower)) return lower;
    const alias = ACTOR_ALIASES[lower] || ACTOR_ALIASES[lower.replace(/\s+/g, '')];
    return alias && BOT_OWNER_SET.has(alias) ? alias : null;
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
    return {
        id: row.id,
        owner: row.owner,
        folder: row.folder,
        archiveSubfolder: row.archive_subfolder || null,
        threadId: row.thread_id,
        from: row.from_owner,
        to: row.to_owner,
        subject: row.subject,
        snippet: snippetOf(row.body),
        format: row.format,
        read: !!row.read,
        flagged: !!row.flagged,
        fwdFromOwner: row.fwd_from_owner || null,
        readByRecipient: !!row.recipient_read_at,
        attachments: attachmentsMetaOf(row.attachments),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function toFull(row) {
    return Object.assign(toSummary(row), { body: row.body, replyToId: row.reply_to_id || null });
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
            subject, body, format, reply_to_id, fwd_from_owner, fwd_from_message_id,
            read, flagged, created_at, updated_at, deleted_at, paired_message_id, attachments
        ) VALUES (
            @id, @owner, @folder, @archive_subfolder, @thread_id, @from_owner, @to_owner,
            @subject, @body, @format, @reply_to_id, @fwd_from_owner, @fwd_from_message_id,
            @read, @flagged, @created_at, @updated_at, @deleted_at, @paired_message_id, @attachments
        )
    `).run(Object.assign({ paired_message_id: null, attachments: null }, row));
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

function copyAttachmentFile(fromMessageId, toMessageId, attachmentId) {
    const data = readAttachmentFile(fromMessageId, attachmentId);
    if (data === null) return;
    writeAttachmentFile(toMessageId, attachmentId, data);
}

function removeMessageAttachmentDir(messageId) {
    if (!isUuidLike(messageId)) return;
    fs.rmSync(messageAttachmentDir(messageId), { recursive: true, force: true });
}

// Copies every attachment id a message references into another message's
// cache folder — used to give the paired sent/inbox copy (and forwards)
// their own on-disk copy, so permanently deleting one never touches another.
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
        }
    }
}

/**
 * Stores attachment metadata in sqlite and the raw bytes under
 * .cache/dovecote/attachments/<messageId>/<attachmentId>. Enforces per-file
 * and total-per-message size limits up front, so a send fails cleanly rather
 * than partially writing attachment files.
 */
function storeAttachments(messageId, attachments) {
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
        writeAttachmentFile(messageId, id, file.data);
        return id;
    });
    return JSON.stringify(ids);
}

/**
 * Returns an attachment's bytes, scoped to an owner the same way mail reads
 * are: the owner must hold a message (any folder) whose attachments[]
 * includes this id, or this behaves as a 404 (returns null) rather than
 * leaking existence of the blob. Bytes are read from that holder message's
 * own cache folder, not a global by-id store.
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
    const data = readAttachmentFile(holder.id, id);
    if (data === null) return null;
    audit(owner, 'get_attachment', id, true, null);
    return { id: meta.id, name: meta.name, mimeType: meta.mime_type, size: meta.size, data };
}

// Posts a read receipt onto a message's paired mailbox copy (sent <-> inbox), the first
// time only (sticky, like a real read receipt) — and only when the actual recipient
// (to_owner) is the one doing the reading. Without that check, a sender marking their own
// already-read sent-folder copy "read" again would wrongly stamp recipient_read_at onto the
// paired inbox copy, as if the recipient had opened it.
function markPairedReadReceipt(owner, row) {
    if (!row || !row.paired_message_id || owner !== row.to_owner) return;
    getDb().prepare(
        `UPDATE dovecote_message SET recipient_read_at = ? WHERE id = ? AND recipient_read_at IS NULL`
    ).run(nowIso(), row.paired_message_id);
}

/**
 * fromOwner is always server-resolved. Bots/jobs may send to any mailbox,
 * including Yukimi's (Yukimi 2026-10-10); they still can never READ hers.
 * attachments (optional): [{ name, mimeType, data: Buffer }], already resolved
 * to raw bytes by the caller (WS handler decodes base64, MCP facade resolves
 * VFS paths or base64) — this layer only enforces size limits and storage.
 */
function sendMail({ fromOwner, to, subject, body, format, replyToId, attachments }) {
    if (!isValidOwner(fromOwner)) throw new DovecoteError('Unknown sender mailbox', 'UNKNOWN_SENDER');
    const toOwner = String(to || '').trim().toLowerCase();
    if (!isValidOwner(toOwner)) throw new DovecoteError(`Unknown recipient mailbox: ${to}`, 'UNKNOWN_RECIPIENT');
    const subjectText = String(subject || '').slice(0, 300);
    const bodyText = String(body || '');
    const formatValue = sanitizeFormat(format);

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
    const inboxId = crypto.randomUUID();
    // Written into the sent copy's folder first, then duplicated into the inbox
    // copy's folder below — each mailbox copy owns its own on-disk bytes.
    const attachmentsJson = storeAttachments(sentId, attachments);
    duplicateMessageAttachments(sentId, inboxId, attachmentsJson);

    insertRow({
        id: sentId, owner: fromOwner, folder: 'sent', archive_subfolder: null, thread_id: threadId,
        from_owner: fromOwner, to_owner: toOwner, subject: subjectText, body: bodyText, format: formatValue,
        reply_to_id: replyTo, fwd_from_owner: null, fwd_from_message_id: null,
        read: 1, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
        paired_message_id: inboxId, attachments: attachmentsJson
    });
    insertRow({
        id: inboxId, owner: toOwner, folder: 'inbox', archive_subfolder: null, thread_id: threadId,
        from_owner: fromOwner, to_owner: toOwner, subject: subjectText, body: bodyText, format: formatValue,
        reply_to_id: replyTo, fwd_from_owner: null, fwd_from_message_id: null,
        read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
        paired_message_id: sentId, attachments: attachmentsJson
    });

    audit(fromOwner, 'send_mail', inboxId, true, `to=${toOwner}`);
    return { id: sentId, threadId, to: toOwner };
}

function listMail(owner, { folder, unreadOnly, limit } = {}) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const cap = Math.max(1, Math.min(200, Number(limit) || 50));
    let sql = 'SELECT * FROM dovecote_message WHERE owner = ?';
    const params = [owner];
    if (folder) {
        sql += ' AND folder = ?';
        params.push(String(folder));
    }
    if (unreadOnly) sql += ' AND read = 0';
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(cap);
    const rows = getDb().prepare(sql).all(...params);
    audit(owner, 'list_mail', null, true, `folder=${folder || 'all'} count=${rows.length}`);
    return rows.map(toSummary);
}

/** Returns null (never throws) when the message does not exist or is not owned by `owner` — callers should treat that as a 404. */
function readMail(owner, id) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const row = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) {
        audit(owner, 'read_mail', id, false, 'not found or not owned');
        return null;
    }
    if (!row.read) {
        getDb().prepare('UPDATE dovecote_message SET read = 1, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
        row.read = 1;
        markPairedReadReceipt(owner, row);
    }
    audit(owner, 'read_mail', id, true, null);
    return toFull(row);
}

function markMail(owner, { id, read, archived, deleted, archiveSubfolder }) {
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
        return permanentlyDeleteMail(owner, id);
    }
    const updates = { updated_at: nowIso() };
    if (typeof read === 'boolean') updates.read = read ? 1 : 0;
    if (read === true) markPairedReadReceipt(owner, row);
    if (deleted === true) {
        updates.folder = 'deleted';
        updates.deleted_at = nowIso();
    } else if (archived === true) {
        updates.folder = 'archive';
        updates.archive_subfolder = archiveSubfolder ? String(archiveSubfolder).slice(0, 80) : null;
    } else if (archived === false || deleted === false) {
        updates.folder = 'inbox';
        updates.archive_subfolder = null;
        updates.deleted_at = null;
    }
    const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    getDb().prepare(`UPDATE dovecote_message SET ${sets} WHERE id = ?`).run(...values, row.id);
    audit(owner, 'mark_mail', id, true, JSON.stringify(updates));
    const updated = getDb().prepare('SELECT * FROM dovecote_message WHERE id = ?').get(row.id);
    return toSummary(updated);
}

/**
 * Forwarding writes a brand-new row (new thread_id) into the target mailbox.
 * It is a copy, not a share — the recipient never gains access to the
 * source thread or mailbox.
 */
function forwardMail(owner, { id, to }) {
    if (!isValidOwner(owner)) throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const toOwner = String(to || '').trim().toLowerCase();
    if (!isValidOwner(toOwner)) throw new DovecoteError(`Unknown recipient mailbox: ${to}`, 'UNKNOWN_RECIPIENT');
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
        read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null,
        attachments: source.attachments || null
    });
    // The forwarded row references the same attachment ids as the source, but
    // needs its own on-disk copy so deleting either message independently
    // never takes the other's attachments with it.
    duplicateMessageAttachments(source.id, newId, source.attachments);
    audit(owner, 'forward_mail', newId, true, `to=${toOwner} source=${id}`);
    return { id: newId, to: toOwner };
}

/**
 * Hard-deletes a message row and its on-disk attachment folder. Unlike
 * markMail's soft delete (which just moves the row into the 'deleted'
 * folder), this cannot be undone — callers trigger it by deleting a message
 * that is already in the 'deleted' folder (see markMail), matching a mail
 * client's "delete from Trash" convention.
 */
function permanentlyDeleteMail(owner, id) {
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
        `SELECT owner, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread
         FROM dovecote_message WHERE folder = 'inbox' GROUP BY owner`
    ).all();
    const byOwner = new Map(counts.map((row) => [row.owner, row.unread]));
    return [HUMAN_OWNER, ...BOT_OWNERS].map((owner) => ({
        owner,
        unread: byOwner.get(owner) || 0
    }));
}

module.exports = {
    HUMAN_OWNER,
    BOT_OWNERS,
    FOLDERS,
    FORMATS,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    DovecoteError,
    isValidOwner,
    isBotOwner,
    resolveOwnerFromActor,
    sendMail,
    listMail,
    readMail,
    markMail,
    forwardMail,
    permanentlyDeleteMail,
    listMailboxes,
    getAlwaysLoadSenders,
    setImagePref,
    getAttachment,
    audit
};
