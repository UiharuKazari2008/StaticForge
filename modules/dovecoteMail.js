/**
 * Dovecote mail business logic. Every read/write is scoped to a single
 * mailbox owner resolved server-side from the caller's identity — callers
 * never supply the owner they want to act as. Non-own reads behave as if
 * the message does not exist (404-shaped: returns null).
 */

'use strict';

const crypto = require('crypto');
const { getDb } = require('./dovecoteDatabase');

const HUMAN_OWNER = 'yukimi';
const BOT_OWNERS = Object.freeze([
    'rook', 'menma', 'hoshino', 'ivory', 'guren', 'chiyo', 'frost', 'sala', 'tifa', 'pyra', 'cursor', 'claude'
]);
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
    const lower = String(actorName).trim().toLowerCase();
    return BOT_OWNER_SET.has(lower) ? lower : null;
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

/**
 * Stores raw attachment bytes (content-addressed id, not owner-scoped) and
 * returns the JSON string to put in a dovecote_message row's attachments
 * column. Enforces per-file and total-per-message size limits up front, so a
 * send fails cleanly rather than partially writing attachment blobs.
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
            'INSERT INTO dovecote_attachment (id, name, mime_type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, String(file.name || 'attachment').slice(0, 200), String(file.mimeType || 'application/octet-stream'), file.data.length, file.data, createdAt);
        return id;
    });
    return JSON.stringify(ids);
}

/**
 * Returns an attachment's bytes, scoped to an owner the same way mail reads
 * are: the owner must hold a message (any folder) whose attachments[]
 * includes this id, or this behaves as a 404 (returns null) rather than
 * leaking existence of the blob.
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
    const row = getDb().prepare('SELECT * FROM dovecote_attachment WHERE id = ?').get(id);
    if (!row) return null;
    audit(owner, 'get_attachment', id, true, null);
    return { id: row.id, name: row.name, mimeType: row.mime_type, size: row.size, data: row.data };
}

// Posts a read receipt onto a message's paired mailbox copy (sent <-> inbox),
// the first time only — recipient_read_at is sticky, like a real read receipt.
function markPairedReadReceipt(row) {
    if (!row || !row.paired_message_id) return;
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
    const attachmentsJson = storeAttachments(attachments);

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
        markPairedReadReceipt(row);
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
    const updates = { updated_at: nowIso() };
    if (typeof read === 'boolean') updates.read = read ? 1 : 0;
    if (read === true) markPairedReadReceipt(row);
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
    audit(owner, 'forward_mail', newId, true, `to=${toOwner} source=${id}`);
    return { id: newId, to: toOwner };
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
    listMailboxes,
    getAlwaysLoadSenders,
    setImagePref,
    getAttachment,
    audit
};
