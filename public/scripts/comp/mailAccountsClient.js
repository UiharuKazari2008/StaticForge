/**
 * IMAP e-mail accounts client (Yozora #789): window.mailAccounts, the one way the phone's Messaging,
 * Dovecote Express, Search Phone, Dreamscape CardSpace and Messaging Bridge reach the server's IMAP
 * accounts (modules/mailAccounts.js). The server is the mail client and keeps a copy; the mail server
 * always wins.
 *
 *   accounts(force)            -> { accounts, presets }   account: { id, email, displayName, name, status, error,
 *                                  unread (Inbox), settings: { notify, saveSent }, sync, push, imap, smtp, hasPassword }
 *   presetFor(email)           -> the provider preset for an address (host, ports, app-password note) or null
 *   folders(accountId)         -> [{ path, name, special ('\\Inbox' | '\\Sent' | '\\Drafts' | '\\Trash' | '\\Junk' | '\\Archive' | null), total, unseen }]
 *   messages(accountId, folder, { limit, before: page.cursor, unseenOnly }) -> { messages, more, cursor }
 *       item: { accountId, folder, uid, subject, sender, from[], to[], cc[], date, seen, flagged, answered, snippet, hasAttachments, size }
 *   message(accountId, folder, uid, { markSeen = true }) -> item + { text, html (sanitized: data-dove-local = same-origin picture
 *       to load, data-blocked-src = remote picture held back), remoteImages[], attachments: [{ part, filename, type, size, inline, url }],
 *       replyTo[], bcc[], inReplyTo, references, listUnsubscribe }
 *   setFlags(accountId, folder, uids, { add, remove })  ('\\Seen', '\\Flagged', '\\Answered')
 *   markRead / markUnread / flag / unflag (accountId, folder, uids)
 *   move(accountId, folder, uids, toFolder) / remove(accountId, folder, uids)   (remove = to Trash, for good in Trash)
 *   upload(file, { onProgress }) -> { uploadId }      (attachments for send; kept an hour)
 *   send(accountId, { to, cc, bcc, subject, text, html, attachments: [uploadId], reply: { folder, uid, kind: 'reply'|'forward' } })
 *   search(q, { accountId, limit }) -> [item]
 *   testAccount / saveAccount / deleteAccount (saveAccount { sameSmtpPassword: true } drops a separate SMTP password; account.hasSmtpPassword), syncStatus(), resync(accountId, rebuild)
 *   unread() -> { total, byAccount: { id: n } }   (Inbox unread)
 *   on(event, fn) / off: 'new' (detail: { accountId, folder, uids, message, notify }) | 'flags' | 'removed' | 'folders' | 'progress' (sync progress, every ~2 s)
 *       | 'account' | 'sync' | 'unread'
 * New mail notifies in the 'mail' class when detail.notify is true.
 */
(function (root) {
    'use strict';

    const handlers = new Map();
    let cache = null;
    let cachePromise = null;
    let wired = false;
    let lastUnread = { total: 0, byAccount: {} };
    let unreadTimer = null;

    const client = () => (root.wsClient && typeof root.wsClient.sendMessage === 'function' ? root.wsClient : null);

    async function call(type, data) {
        const c = client();
        if (!c) throw Object.assign(new Error('Melaton is not connected to the server.'), { code: 'OFFLINE' });
        const msg = await c.sendMessage(type, data || {}, false);
        const d = (msg && msg.data) || msg || {};
        if (d.success === false) throw Object.assign(new Error(d.error || 'The request failed.'), { code: d.code || 'ERROR' });
        return d;
    }

    function fire(event, detail) {
        (handlers.get(event) || []).slice().forEach((fn) => { try { fn(detail); } catch (error) { console.error('[mailAccounts] handler failed:', error); } });
    }
    function on(event, fn) { wire(); if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); }
    function off(event, fn) { const l = handlers.get(event); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }

    function wire() {
        if (wired) return true;
        const c = client();
        if (!c || typeof c.on !== 'function') return false;
        wired = true;
        c.on('ma_event', (msg) => {
            const d = (msg && msg.data) || {};
            if (d.event === 'account') cache = null;
            fire(d.event, d);
            if (['new', 'flags', 'removed', 'folders', 'account', 'sync'].includes(d.event)) scheduleUnread();
        });
        c.on('connected', () => { cache = null; scheduleUnread(); });
        return true;
    }

    async function accounts(force) {
        wire();
        if (cache && !force) return cache;
        if (!cachePromise) {
            cachePromise = call('ma_accounts').then((d) => { cache = { accounts: d.accounts || [], presets: d.presets || [] }; tally(cache.accounts); return cache; })
                .finally(() => { cachePromise = null; });
        }
        return cachePromise;
    }

    function tally(list) {
        const byAccount = {};
        let total = 0;
        for (const a of list || []) { const n = Number(a.unread) || 0; byAccount[a.id] = n; total += n; }
        const changed = JSON.stringify(byAccount) !== JSON.stringify(lastUnread.byAccount);
        lastUnread = { total, byAccount };
        if (changed) fire('unread', lastUnread);
    }

    function scheduleUnread() {
        clearTimeout(unreadTimer);
        unreadTimer = setTimeout(() => { accounts(true).catch(() => {}); }, 1200);
    }

    function presetFor(email) {
        const domain = String(email || '').split('@')[1] || '';
        const list = (cache && cache.presets) || [];
        return list.find((p) => (p.domains || []).includes(domain.toLowerCase())) || null;
    }

    const folders = (accountId) => call('ma_folders', { accountId }).then((d) => d.folders || []);
    const messages = (accountId, folder, opts) => call('ma_messages', Object.assign({ accountId, folder }, opts || {}));
    const message = (accountId, folder, uid, opts) => call('ma_message', Object.assign({ accountId, folder, uid }, opts || {})).then((d) => d.message);
    const setFlags = (accountId, folder, uids, change) => call('ma_flags', Object.assign({ accountId, folder, uids: [].concat(uids) }, change || {}));
    const markRead = (a, f, u) => setFlags(a, f, u, { add: ['\\Seen'] });
    const markUnread = (a, f, u) => setFlags(a, f, u, { remove: ['\\Seen'] });
    const flag = (a, f, u) => setFlags(a, f, u, { add: ['\\Flagged'] });
    const unflag = (a, f, u) => setFlags(a, f, u, { remove: ['\\Flagged'] });
    const move = (accountId, folder, uids, to) => call('ma_move', { accountId, folder, uids: [].concat(uids), to });
    const remove = (accountId, folder, uids) => call('ma_delete', { accountId, folder, uids: [].concat(uids) });
    const send = (accountId, mail) => call('ma_send', Object.assign({ accountId }, mail || {}));
    const search = (q, opts) => call('ma_search', Object.assign({ q }, opts || {})).then((d) => d.results || []);
    const testAccount = (a) => call('ma_account_test', a || {});
    const saveAccount = (a) => call('ma_account_save', a || {}).then((d) => { cache = null; return d.account; });
    const deleteAccount = (id) => call('ma_account_delete', { id }).then((d) => { cache = null; return d; });
    const syncStatus = () => call('ma_sync_status');
    const resync = (accountId, rebuild) => call('ma_resync', { accountId, rebuild: !!rebuild });
    const unread = () => lastUnread;

    function upload(file, opts) {
        const o = opts || {};
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/mailaccounts/upload?name=${encodeURIComponent((file && file.name) || 'attachment')}`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Content-Type', (file && file.type) || 'application/octet-stream');
            if (typeof o.onProgress === 'function') xhr.upload.onprogress = (e) => { if (e.lengthComputable) o.onProgress(e.loaded / e.total); };
            xhr.onload = () => {
                let d = null;
                try { d = JSON.parse(xhr.responseText); } catch (_) { d = null; }
                if (xhr.status >= 200 && xhr.status < 300 && d && d.success !== false) resolve(d);
                else reject(Object.assign(new Error((d && d.error) || `The attachment could not be uploaded (${xhr.status}).`), { code: (d && d.code) || 'ERROR' }));
            };
            xhr.onerror = () => reject(Object.assign(new Error('The attachment could not be uploaded.'), { code: 'NETWORK' }));
            xhr.send(file);
        });
    }

    root.mailAccounts = {
        accounts, presetFor, folders, messages, message, setFlags, markRead, markUnread, flag, unflag, move, remove,
        upload, send, search, testAccount, saveAccount, deleteAccount, syncStatus, resync, unread, on, off
    };
    if (!wire()) {
        const t = setInterval(() => { if (wire()) { clearInterval(t); scheduleUnread(); } }, 1000);
        setTimeout(() => clearInterval(t), 120000);
    } else {
        scheduleUnread();
    }
})(typeof window !== 'undefined' ? window : globalThis);
