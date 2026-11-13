/**
 * IMAP for e-mail accounts (Yozora #789): the connection, folder listing, and the sync of one folder
 * into the server's copy (mailAccountsStore.js). Used by the sync worker process (the whole account)
 * and by the server (new mail on IDLE, opening an attachment, flags, moves).
 *
 * A folder's sync (the mail server wins): UIDVALIDITY changed -> the copy of that folder is void;
 * the server's UID list against the copy's: missing UIDs are fetched newest first (envelope, flags,
 * structure, text and HTML bodies; attachments only as a list, their bodies come on open), UIDs the
 * server no longer has leave the copy, then every message's flags are compared.
 */
'use strict';

const { ImapFlow } = require('imapflow');

// Gmail's virtual folders repeat mail kept elsewhere (All Mail, Starred, Important)
const SKIP_SPECIAL = new Set(['\\All', '\\Flagged']);
const SKIP_NAMES = /^\[(gmail|google mail)\]\/(important|all mail|starred)$/i;
const SMALL_SOURCE = 2 * 1024 * 1024; // up to this, the whole message is fetched and parsed
const BATCH = 50;

function client(account, password) {
    return new ImapFlow({
        host: account.imap.host,
        port: Number(account.imap.port) || 993,
        secure: account.imap.security !== 'starttls' && account.imap.security !== 'none',
        doSTARTTLS: account.imap.security === 'starttls' ? true : undefined,
        auth: { user: account.imap.user || account.email, pass: password },
        logger: false,
        emitLogs: false,
        connectionTimeout: 30000,
        greetingTimeout: 20000,
        socketTimeout: 5 * 60 * 1000,
        tls: { rejectUnauthorized: account.imap.allowSelfSigned ? false : true }
    });
}

function addrList(list) {
    return (Array.isArray(list) ? list : []).map((a) => ({ name: a.name || '', address: a.address || '' })).filter((a) => a.address || a.name);
}

function addrText(list) {
    return addrList(list).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

/** The attachments and the text parts of a BODYSTRUCTURE. */
function walkStructure(node, out = { att: [], text: null, html: null }) {
    if (!node) return out;
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
        for (const c of node.childNodes) walkStructure(c, out);
        return out;
    }
    const type = String(node.type || '').toLowerCase();
    const disp = String(node.disposition || '').toLowerCase();
    const params = Object.assign({}, node.parameters || {}, node.dispositionParameters || {});
    const filename = params.filename || params.name || '';
    const part = node.part || '1';
    if (!filename && disp !== 'attachment' && (type === 'text/plain' || type === 'text/html')) {
        if (type === 'text/plain' && !out.text) out.text = { part, charset: params.charset || 'utf-8', encoding: node.encoding };
        if (type === 'text/html' && !out.html) out.html = { part, charset: params.charset || 'utf-8', encoding: node.encoding };
        return out;
    }
    if (type.startsWith('multipart/')) return out;
    out.att.push({ part, filename: filename || `attachment-${part}`, type, size: Number(node.size) || 0, cid: node.id ? String(node.id).replace(/[<>]/g, '') : null, inline: disp === 'inline' && !!node.id });
    return out;
}

function snippetOf(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function streamToBuffer(stream, max) {
    const parts = [];
    let n = 0;
    for await (const c of stream) { n += c.length; if (max && n > max) break; parts.push(c); }
    return Buffer.concat(parts);
}

/** Envelope + flags + structure + bodies of these UIDs, as store rows. */
async function fetchRows(c, uidList) {
    const { simpleParser } = require('mailparser');
    const rows = [];
    const meta = [];
    for await (const m of c.fetch(uidList.join(','), { uid: true, envelope: true, flags: true, bodyStructure: true, size: true, internalDate: true, headers: ['references', 'in-reply-to', 'reply-to', 'list-unsubscribe'] }, { uid: true })) {
        meta.push(m);
    }
    for (const m of meta) {
        const env = m.envelope || {};
        const st = walkStructure(m.bodyStructure);
        let text = '';
        let html = '';
        let headers = {};
        try {
            if ((m.size || 0) <= SMALL_SOURCE) {
                const one = await c.fetchOne(String(m.uid), { source: true }, { uid: true });
                if (one && one.source) {
                    const parsed = await simpleParser(one.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
                    text = parsed.text || '';
                    html = typeof parsed.html === 'string' ? parsed.html : '';
                    headers = { references: parsed.references || null, inReplyTo: parsed.inReplyTo || null, replyTo: parsed.replyTo ? parsed.replyTo.text : null, listUnsubscribe: parsed.headers && parsed.headers.get('list-unsubscribe') ? String(parsed.headers.get('list-unsubscribe').url || parsed.headers.get('list-unsubscribe')) : null };
                }
            } else {
                for (const [key, p] of [['text', st.text], ['html', st.html]]) {
                    if (!p) continue;
                    const dl = await c.download(String(m.uid), p.part, { uid: true });
                    if (dl && dl.content) {
                        const buf = await streamToBuffer(dl.content, 4 * 1024 * 1024);
                        if (key === 'text') text = buf.toString('utf8'); else html = buf.toString('utf8');
                    }
                }
            }
        } catch (_) { /* the envelope is kept; the body comes on open */ }
        rows.push({
            uid: m.uid,
            msgid: env.messageId || null,
            date: (env.date ? new Date(env.date) : (m.internalDate ? new Date(m.internalDate) : new Date())).getTime(),
            sender: addrText(env.from),
            recipients: [addrText(env.to), addrText(env.cc)].filter(Boolean).join(', '),
            subject: env.subject || '',
            flags: [...(m.flags || [])],
            size: m.size || 0,
            snippet: snippetOf(text || String(html).replace(/<[^>]+>/g, ' ')),
            att: st.att,
            env: { from: addrList(env.from), to: addrList(env.to), cc: addrList(env.cc), bcc: addrList(env.bcc), replyTo: addrList(env.replyTo), inReplyTo: env.inReplyTo || headers.inReplyTo || null, references: headers.references || null, listUnsubscribe: headers.listUnsubscribe || null },
            text,
            html,
            body: !!(text || html)
        });
    }
    return rows;
}

/** The account's folders, sync-worthy ones only, with their special use. */
async function listFolders(c) {
    const list = await c.list({ statusQuery: { messages: true, unseen: true, uidValidity: true } });
    return list
        .filter((f) => !(f.flags && f.flags.has && f.flags.has('\\Noselect')) && !SKIP_SPECIAL.has(f.specialUse) && !SKIP_NAMES.test(f.path))
        .map((f) => ({
            path: f.path, name: f.name, delimiter: f.delimiter, special: f.specialUse || (f.path.toUpperCase() === 'INBOX' ? '\\Inbox' : null),
            uidvalidity: f.status && f.status.uidValidity != null ? String(f.status.uidValidity) : null,
            total: f.status ? f.status.messages : 0, unseen: f.status ? f.status.unseen : 0
        }));
}

/**
 * Sync one folder into the store (the server wins). progress(n) after each batch.
 * -> { fetched, removed, flagsChanged }
 */
async function syncFolder(c, store, accountId, folder, progress) {
    const lock = await c.getMailboxLock(folder.path);
    try {
        const mb = c.mailbox;
        const validity = mb && mb.uidValidity != null ? String(mb.uidValidity) : null;
        const known = store.getFolder(accountId, folder.path);
        if (known && known.uidvalidity && validity && known.uidvalidity !== validity) store.clearFolder(accountId, folder.path);
        store.putFolder(accountId, Object.assign({}, folder, { uidvalidity: validity }));
        const server = (mb && mb.exists) ? await c.search({ all: true }, { uid: true }) : [];
        const serverSet = new Set(server);
        const local = store.uids(accountId, folder.path);
        const localSet = new Set(local);
        const removed = local.filter((u) => !serverSet.has(u));
        if (removed.length) store.deleteMessages(accountId, folder.path, removed);
        const missing = server.filter((u) => !localSet.has(u)).sort((a, b) => b - a);
        let fetched = 0;
        for (let i = 0; i < missing.length; i += BATCH) {
            const rows = await fetchRows(c, missing.slice(i, i + BATCH));
            store.putMessages(accountId, folder.path, rows);
            fetched += rows.length;
            if (progress) progress(fetched, missing.length);
        }
        // flags: the server's for every message the copy holds
        let flagsChanged = 0;
        if (server.length) {
            const before = store.flagMap(accountId, folder.path);
            for await (const m of c.fetch('1:*', { uid: true, flags: true })) {
                const f = JSON.stringify([...(m.flags || [])]);
                if (before.has(m.uid) && before.get(m.uid) !== f) flagsChanged += store.setFlags(accountId, folder.path, m.uid, [...(m.flags || [])]);
            }
        }
        store.recount(accountId, folder.path);
        store.setFolderSynced(accountId, folder.path, true);
        return { fetched, removed: removed.length, flagsChanged };
    } finally {
        lock.release();
    }
}

module.exports = { client, listFolders, syncFolder, fetchRows, walkStructure, addrList, addrText, snippetOf };
