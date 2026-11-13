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
 *   search(q, { accountId?, limit }) -> [{ accountId, account, chatGuid, chatTitle, known, message }]
 *   markRead(accountId, chatGuid) / markUnread(accountId, chatGuid) / typing(accountId, chatGuid, bool)  (typing is throttled)
 *   testAccount / saveAccount / deleteAccount / saveSettings({ notifyUnknown })
 *   pairRcs(accountId) -> { qr }   (show the URL as a QR code; 'pairing' events: { qr } refreshed, { paired: true })
 *   pairRcsGoogle(accountId) -> { emoji }  (Google account pairing: the sign-in is Alchemy's, signed in at
 *       messages.google.com; 'pairing' events: { emoji, emojiSvg }, then { paired: true } or { error })
 *   refreshRcsQr(accountId) / unpairRcs(accountId)
 *   An RCS account is saveAccount({ kind: 'rcs' }) (one per server); status 'unpaired' until paired.
 *   messages() pages back with { before: page.cursor } (opaque: a date for iMessage, a cursor for RCS).
 *   on(event, fn) / off(event, fn)
 *       'message' | 'updated' | 'reaction' | 'typing' | 'read' | 'chat' | 'account' | 'settings' | 'pairing'
 *       | 'resync' | 'unread' (detail = { total, byAccount: { id: { unread, unknownUnread } } })
 *   unread()                        -> the last 'unread' detail
 *   snapshot()                      -> what the logon step read: { at, accounts, settings, inbox: { id: chats } }
 *                                      (null before it ran); UIs draw from it at once, then refresh
 *   preload()                       the logon step itself ('Loading text messages', at most 6 s)
 *   REACTIONS                       [{ type, label, glyph }]
 *   links(text) / linkify(text, cls) -> the links in a message / its text as HTML with <a> links
 *   linkPreview(url)                -> { title, description, image, site } or null (cached)
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
        if (snap) snap.accounts = list;
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

    const chats = (accountId, opts) => call('tm_chats', Object.assign({ accountId }, opts || {})).then((d) => {
        // the newest Inbox page keeps the snapshot fresh for the next first draw
        if (snap && opts && opts.folder === 'inbox' && !opts.offset && Array.isArray(d.chats)) snap.inbox[accountId] = d.chats.slice(0, 20);
        return d;
    });

    // ---- the logon snapshot ----
    // Text Messaging is read while the logon dialog runs (like the user settings), so Today, Messaging,
    // the status bar and Melaton Messenger have the accounts, counts and newest conversations when the
    // desktop comes up instead of loading them afterwards.
    let snap = null;
    function snapshot() { return snap; }

    async function preload() {
        wire();
        const work = (async () => {
            const d = await accounts(true);
            snap = { at: Date.now(), accounts: d.accounts || [], settings: d.settings || {}, inbox: {} };
            if (!snap.accounts.length) return;
            const list = await summary().catch(() => snap.accounts);
            await Promise.all((list || []).filter((a) => a.status === 'connected' && a.enabled !== false).map((a) =>
                chats(a.id, { folder: 'inbox', limit: 20 }).catch(() => null)));
            fire('snapshot', snap);
        })();
        // a Mac or phone that does not answer must not hold the logon: the UIs load it themselves then
        await Promise.race([work.catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
    }
    const chat = (accountId, chatGuid) => call('tm_chat', { accountId, chatGuid }).then((d) => d.chat || null);
    const messages = (accountId, chatGuid, opts) => call('tm_messages', Object.assign({ accountId, chatGuid }, opts || {}));
    const send = (accountId, args) => call('tm_send', Object.assign({ accountId }, args || {}));
    const react = (accountId, args) => call('tm_react', Object.assign({ accountId }, args || {}));
    const edit = (accountId, args) => call('tm_edit', Object.assign({ accountId }, args || {}));
    const unsend = (accountId, args) => call('tm_unsend', Object.assign({ accountId }, args || {}));
    const markRead = (accountId, chatGuid) => call('tm_read', { accountId, chatGuid }).then((d) => { scheduleUnread(); return d; });
    const search = (q, opts) => call('tm_search', Object.assign({ q }, opts || {})).then((d) => d.results || []);
    const deleteChat = (accountId, chatGuid) => call('tm_delete_chat', { accountId, chatGuid }).then((d) => { scheduleUnread(); return d; });
    const markUnread = (accountId, chatGuid) => call('tm_unread', { accountId, chatGuid }).then((d) => { scheduleUnread(); return d; });
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

    const pairRcs = (accountId) => call('tm_rcs_pair', { accountId });
    const refreshRcsQr = (accountId) => call('tm_rcs_refresh_qr', { accountId });
    const pairRcsGoogle = (accountId) => call('tm_rcs_pair_google', { accountId });
    const unpairRcs = (accountId) => call('tm_rcs_unpair', { accountId }).then((d) => { cache = null; return d; });

    // ---- links in messages ----
    const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;
    const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /** The links in a text (http/https; www. gets https://). */
    function links(text) {
        const out = [];
        String(text || '').replace(URL_RE, (m) => { out.push(/^www\./i.test(m) ? `https://${m}` : m); return m; });
        return out;
    }

    /** A message's text as HTML: escaped, links as <a> (opened by the caller's click handling). */
    function linkify(text, cls) {
        let html = '';
        let last = 0;
        const s = String(text || '');
        s.replace(URL_RE, (m, _g, at) => {
            html += escHtml(s.slice(last, at));
            const href = /^www\./i.test(m) ? `https://${m}` : m;
            html += `<a class="${cls || 'tm-link'}" href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${escHtml(m)}</a>`;
            last = at + m.length;
            return m;
        });
        return html + escHtml(s.slice(last));
    }

    const previewCache = new Map();
    /** { url, title, description, image, site } for a link (the server reads the page's head), or null. */
    function linkPreview(url) {
        if (!previewCache.has(url)) {
            previewCache.set(url, fetch(`/api/textmessaging/link-preview?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' })
                .then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.success !== false && (d.title || d.image) ? d : null)).catch(() => null));
            if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value);
        }
        return previewCache.get(url);
    }

    root.textMessaging = {
        links, linkify, linkPreview,
        accounts, summary, unread, snapshot, preload, label, chats, chat, messages, send, sendFile, react, edit, unsend,
        markRead, markUnread, deleteChat, search, typing, resolve, testAccount, saveAccount, deleteAccount, saveSettings, pairRcs, pairRcsGoogle, refreshRcsQr,
        unpairRcs, on, off, REACTIONS
    };
    // A tapped Android notification (the app's TextMessageNotifier, #779): open that conversation in
    // Melaton Mobile's Text Messaging once it is loaded. A running page gets 'dreamscapetextmessage';
    // a page that was started by the tap asks AndroidActiveSync.takePendingTextMessage().
    let lastOpen = { key: '', at: 0 };
    function openFromNotification(d) {
        if (!d || !d.accountId || !d.chatGuid) return;
        const key = `${d.accountId}|${d.chatGuid}`;
        if (lastOpen.key === key && Date.now() - lastOpen.at < 5000) return;
        lastOpen = { key, at: Date.now() };
        let tries = 0;
        const go = () => {
            const app = root.wmTextMessaging;
            if (app && typeof app.openChat === 'function') { try { app.openChat(d.accountId, d.chatGuid); } catch (error) { console.error('[textMessaging] open failed:', error); } return; }
            if ((tries += 1) < 240) setTimeout(go, 500);
        };
        go();
    }
    if (root.addEventListener) root.addEventListener('dreamscapetextmessage', (e) => openFromNotification(e && e.detail));
    try {
        const bridge = root.AndroidActiveSync;
        const raw = bridge && typeof bridge.takePendingTextMessage === 'function' ? bridge.takePendingTextMessage() : '';
        if (raw) openFromNotification(JSON.parse(raw));
    } catch (_) { /* an older app */ }

    // the logon step (websocket.js registerInitStep; { logon: true } runs in the logon dialog, again on
    // a reconnect); administrators only (the server refuses others at once)
    if (root.wsClient && typeof root.wsClient.registerInitStep === 'function') {
        root.wsClient.registerInitStep(0.48, 'Loading text messages', async () => {
            try { await preload(); } catch (_) { /* the UIs load it themselves */ }
        }, true, { logon: true });
    }

    wire();
    if (!wired) {
        // wsClient may come up after this script
        const t = setInterval(() => { if (wire()) { clearInterval(t); scheduleUnread(); } }, 1000);
        setTimeout(() => clearInterval(t), 120000);
    } else {
        scheduleUnread();
    }
})(typeof window !== 'undefined' ? window : globalThis);
