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
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function toFull(row) {
    return Object.assign(toSummary(row), { body: row.body, replyToId: row.reply_to_id || null });
}

function insertRow(row) {
    getDb().prepare(`
        INSERT INTO dovecote_message (
            id, owner, folder, archive_subfolder, thread_id, from_owner, to_owner,
            subject, body, format, reply_to_id, fwd_from_owner, fwd_from_message_id,
            read, flagged, created_at, updated_at, deleted_at
        ) VALUES (
            @id, @owner, @folder, @archive_subfolder, @thread_id, @from_owner, @to_owner,
            @subject, @body, @format, @reply_to_id, @fwd_from_owner, @fwd_from_message_id,
            @read, @flagged, @created_at, @updated_at, @deleted_at
        )
    `).run(row);
}

function sanitizeFormat(format) {
    const value = String(format || 'text').trim().toLowerCase();
    return FORMATS.includes(value) ? value : 'text';
}

/**
 * fromOwner is always server-resolved. A bot/job sender may only target
 * another bot/job mailbox — never Yukimi's, which only she can write to.
 */
function sendMail({ fromOwner, to, subject, body, format, replyToId }) {
    if (!isValidOwner(fromOwner)) throw new DovecoteError('Unknown sender mailbox', 'UNKNOWN_SENDER');
    const toOwner = String(to || '').trim().toLowerCase();
    if (!isValidOwner(toOwner)) throw new DovecoteError(`Unknown recipient mailbox: ${to}`, 'UNKNOWN_RECIPIENT');
    if (isBotOwner(fromOwner) && toOwner === HUMAN_OWNER) {
        audit(fromOwner, 'send_mail', null, false, 'bot attempted to write to Yukimi mailbox');
        throw new DovecoteError('Bots and jobs cannot send mail into Yukimi\'s mailbox', 'FORBIDDEN');
    }
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

    insertRow({
        id: sentId, owner: fromOwner, folder: 'sent', archive_subfolder: null, thread_id: threadId,
        from_owner: fromOwner, to_owner: toOwner, subject: subjectText, body: bodyText, format: formatValue,
        reply_to_id: replyTo, fwd_from_owner: null, fwd_from_message_id: null,
        read: 1, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null
    });
    insertRow({
        id: inboxId, owner: toOwner, folder: 'inbox', archive_subfolder: null, thread_id: threadId,
        from_owner: fromOwner, to_owner: toOwner, subject: subjectText, body: bodyText, format: formatValue,
        reply_to_id: replyTo, fwd_from_owner: null, fwd_from_message_id: null,
        read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null
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
    if (isBotOwner(owner) && toOwner === HUMAN_OWNER) {
        audit(owner, 'forward_mail', id, false, 'bot attempted to forward into Yukimi mailbox');
        throw new DovecoteError('Bots and jobs cannot forward mail into Yukimi\'s mailbox', 'FORBIDDEN');
    }
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
        read: 0, flagged: 0, created_at: createdAt, updated_at: createdAt, deleted_at: null
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
    audit
};
