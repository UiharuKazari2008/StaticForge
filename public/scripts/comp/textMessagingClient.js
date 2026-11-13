/**
 * Text Messaging client (Yozora #779): window.textMessaging, the one way the phone's Messaging,
 * Melaton Messenger on the desktop, Today and Dreamscape CardSpace reach the server's Text
 * Messaging accounts (modules/textMessaging.js; BlueBubbles = iMessage, later RCS).
 *
 *   accounts(force)                 -> { accounts, settings }   (cached; 'account' events refresh it)
 *   summary()                       -> accounts with fresh unread / unknownUnread counts
 *   label(account)                  -> { title: 'Text Messaging', subline }  (Apple ID / phone number)
 *   chats(accountId, { folder: 'inbox'|'unknown'|'all', limit, offset }) -> { chats, more }
 *   chat(accountId, chatGuid)       -> chat
 *   messages(accountId, chatGuid, { limit, before }) -> { messages (oldest first), more }
 *   send(accountId, { chatGuid | addresses, text, replyTo, subject, effect }) -> { tempGuid, chatGuid, message }
 *   sendFile(accountId, chatGuid, file, { replyTo, audio, onProgress(0..1) }) -> { tempGuid, message }
 *   react(accountId, { chatGuid, messageGuid, messageText, reaction, remove })
 *   edit(accountId, { messageGuid, text }) / unsend(accountId, { messageGuid })
 *   markRead(accountId, chatGuid) / typing(accountId, chatGuid, bool)  (typing is throttled)
 *   testAccount / saveAccount / deleteAccount / saveSettings({ notifyUnknown })
 *   on(event, fn) / off(event, fn)
 *       'message' | 'updated' | 'reaction' | 'typing' | 'read' | 'chat' | 'account' | 'settings'
 *       | 'resync' | 'unread' (detail = { total, byAccount: { id: { unread, unknownUnread } } })
 *   unread()                        -> the last 'unread' detail
 *   REACTIONS                       [{ type, label, glyph }]
 *
 * A 'message' event's detail carries known (false = Unknown Senders), folder and notify (the
 * server's rule: incoming, not a group event, known or notifyUnknown on). Text messages notify in
 * their own class, 'sms' (Dreamscape Messenger, the chat personas, is 'chat').
 */
(function (root) {
    'use strict';

    const REACTIONS = [
        { type: 'love', label: 'Love', glyph: '❤' },
        { type: 'like', label: 'Like', glyph: '👍' },
        { type: 'dislike', label: 'Dislike', glyph: '👎' },
        { type: 'laugh', label: 'Laugh', glyph: 'HA' },
        { type: 'emphasize', label: 'Emphasize', glyph: '!!' },
        { type: 'question', label: 'Question', glyph: '?' }
    ];
    const TYPING_THROTTLE_MS = 4000;
    const UNREAD_DEBOUNCE_MS = 1500;

    const handlers = new Map();
    let cache = null;
    let cachePromise = null;
    let wired = false;
    let lastUnread = { total: 0, byAccount: {} };
    let unreadTimer = null;
    const typingAt = new Map();

    function client() {
        return root.wsClient && typeof root.wsClient.sendMessage === 'function' ? root.wsClient : null;
    }

    async function call(type, data) {
        const c = client();
        if (!c) throw Object.assign(new Error('Melaton is not connected to the server.'), { code: 'OFFLINE' });
        const msg = await c.sendMessage(type, data || {}, false);
        const d = (msg && msg.data) || msg || {};
        if (d.success === false) throw Object.assign(new Error(d.error || 'The request failed.'), { code: d.code || 'ERROR' });
        return d;
    }

    function fire(event, detail) {
        (handlers.get(event) || []).slice().forEach((fn) => { try { fn(detail); } catch (error) { console.error('[textMessaging] handler failed:', error); } });
    }

    function on(event, fn) {
        wire();
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(fn);
    }

    function off(event, fn) {
        const list = handlers.get(event);
        if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
    }

    function wire() {
        if (wired) return true;
        const c = client();
        if (!c || typeof c.on !== 'function') return false;
        wired = true;
        c.on('tm_event', (msg) => {
            const d = (msg && msg.data) || {};
            if (d.event === 'account' || d.event === 'settings') { cache = null; }
            fire(d.event, d);
            if (['message', 'updated', 'reaction', 'read', 'account', 'resync'].includes(d.event)) scheduleUnread();
        });
        c.on('connected', () => { cache = null; scheduleUnread(); });
        return true;
    }

    // ---- accounts ----

    async function accounts(force) {
        wire();
        if (cache && !force) return cache;
        if (!cachePromise) {
            cachePromise = call('tm_accounts').then((d) => {
                cache = { accounts: d.accounts || [], settings: d.settings || { notifyUnknown: false } };
                return cache;
            }).finally(() => { cachePromise = null; });
        }
        return cachePromise;
    }

    function tally(list) {
        const byAccount = {};
        let total = 0;
        for (const a of list || []) {
            const u = Number(a.unread) || 0;
            byAccount[a.id] = { unread: u, unknownUnread: Number(a.unknownUnread) || 0 };
            total += u;
        }
        return { total, byAccount };
    }

    async function summary() {
        const d = await call('tm_summary');
        const list = d.accounts || [];
        if (cache) cache.accounts = list;
        lastUnread = tally(list);
        fire('unread', lastUnread);
        return list;
    }

    function scheduleUnread() {
        clearTimeout(unreadTimer);
        unreadTimer = setTimeout(() => { summary().catch(() => {}); }, UNREAD_DEBOUNCE_MS);
    }

    function unread() { return lastUnread; }

    /** The account's line in pickers: the title, and the Apple ID / phone number under it. */
    function label(account) {
        const a = account || {};
        let subline = a.identity || '';
        if (!subline) subline = a.status === 'connected' ? (a.service || '') : (a.status === 'disabled' ? 'Turned off' : (a.error || 'Not connected'));
        return { title: a.name || 'Text Messaging', subline };
    }

    // ---- conversations ----

    const chats = (accountId, opts) => call('tm_chats', Object.assign({ accountId }, opts || {}));
    const chat = (accountId, chatGuid) => call('tm_chat', { accountId, chatGuid }).then((d) => d.chat || null);
    const messages = (accountId, chatGuid, opts) => call('tm_messages', Object.assign({ accountId, chatGuid }, opts || {}));
    const send = (accountId, args) => call('tm_send', Object.assign({ accountId }, args || {}));
    const react = (accountId, args) => call('tm_react', Object.assign({ accountId }, args || {}));
    const edit = (accountId, args) => call('tm_edit', Object.assign({ accountId }, args || {}));
    const unsend = (accountId, args) => call('tm_unsend', Object.assign({ accountId }, args || {}));
    const markRead = (accountId, chatGuid) => call('tm_read', { accountId, chatGuid }).then((d) => { scheduleUnread(); return d; });
    const resolve = (accountId, address) => call('tm_resolve', { accountId, address }).then((d) => d.name || '');

    function typing(accountId, chatGuid, on) {
        const key = `${accountId}|${chatGuid}`;
        const now = Date.now();
        if (on && now - (typingAt.get(key) || 0) < TYPING_THROTTLE_MS) return Promise.resolve({ ok: true });
        if (on) typingAt.set(key, now); else typingAt.delete(key);
        return call('tm_typing', { accountId, chatGuid, typing: !!on }).catch(() => ({ ok: false }));
    }

    function sendFile(accountId, chatGuid, file, opts) {
        const o = opts || {};
        return new Promise((resolvePromise, reject) => {
            const q = new URLSearchParams({ chat: chatGuid, name: (file && file.name) || 'attachment' });
            if (o.replyTo) q.set('replyTo', o.replyTo);
            if (o.audio) q.set('audio', '1');
            if (o.tempGuid) q.set('tempGuid', o.tempGuid);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/textmessaging/${encodeURIComponent(accountId)}/send-attachment?${q}`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Content-Type', (file && file.type) || 'application/octet-stream');
            if (typeof o.onProgress === 'function') xhr.upload.onprogress = (e) => { if (e.lengthComputable) o.onProgress(e.loaded / e.total); };
            xhr.onload = () => {
                let d = null;
                try { d = JSON.parse(xhr.responseText); } catch (_) { d = null; }
                if (xhr.status >= 200 && xhr.status < 300 && d && d.success !== false) resolvePromise(d);
                else reject(Object.assign(new Error((d && d.error) || `The file could not be sent (${xhr.status}).`), { code: (d && d.code) || 'ERROR' }));
            };
            xhr.onerror = () => reject(Object.assign(new Error('The file could not be sent.'), { code: 'NETWORK' }));
            xhr.send(file);
        });
    }

    // ---- setup ----

    const testAccount = (args) => call('tm_account_test', args || {});
    const saveAccount = (args) => call('tm_account_save', args || {}).then((d) => { cache = null; return d.account; });
    const deleteAccount = (id) => call('tm_account_delete', { id }).then((d) => { cache = null; return d; });
    const saveSettings = (s) => call('tm_settings_save', s || {}).then((d) => { cache = null; return d.settings; });

    root.textMessaging = {
        accounts, summary, unread, label, chats, chat, messages, send, sendFile, react, edit, unsend,
        markRead, typing, resolve, testAccount, saveAccount, deleteAccount, saveSettings, on, off, REACTIONS
    };
    wire();
    if (!wired) {
        // wsClient may come up after this script
        const t = setInterval(() => { if (wire()) { clearInterval(t); scheduleUnread(); } }, 1000);
        setTimeout(() => clearInterval(t), 120000);
    } else {
        scheduleUnread();
    }
})(typeof window !== 'undefined' ? window : globalThis);
